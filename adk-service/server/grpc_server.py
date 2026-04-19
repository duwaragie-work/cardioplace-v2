"""
gRPC servicer for the Cardioplace voice agent.

Thin wrapper around VoiceSession (the Groq + Cerebras + Piper state machine
that replaced the Google ADK Runner). Responsibilities:

  1. Read the first ClientMessage (must be SessionInit).
  2. Create a VoiceSession and wire its out_queue to the gRPC response stream.
  3. Run two concurrent tasks:
     - forward_input: ClientMessage → VoiceSession method calls.
     - yield_output: out_queue → gRPC ServerMessage stream.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import AsyncIterator

from grpc import aio
from opentelemetry import trace as otel_trace

from generated import voice_pb2, voice_pb2_grpc

logger = logging.getLogger(__name__)
_tracer = otel_trace.get_tracer("healplace.voice")

_VOICE_DEBUG = os.getenv("VOICE_DEBUG", "") == "1"

# Sentinel — signals that the turn queue has no more messages.
_DONE = object()


class VoiceAgentServicer(voice_pb2_grpc.VoiceAgentServicer):
    def __init__(self, tts_synth, piper_fillers: list[bytes]) -> None:
        # tts_synth and piper_fillers are loaded once at process start and
        # passed to every session — Piper's ONNX runtime is thread-safe for
        # inference, so a single instance serves all connected clients.
        self._tts_synth = tts_synth
        self._piper_fillers = piper_fillers

    async def StreamSession(
        self,
        request_iterator: AsyncIterator[voice_pb2.ClientMessage],
        context: aio.ServicerContext,
    ):
        # ── Step 1: Read SessionInit ─────────────────────────────────────
        try:
            first = await request_iterator.__anext__()
        except StopAsyncIteration:
            return

        if not first.HasField("init"):
            yield voice_pb2.ServerMessage(
                error=voice_pb2.SessionError(message="First message must be SessionInit")
            )
            return

        init = first.init
        user_id = init.user_id
        patient_context = init.patient_context or "No context available."
        auth_token = init.auth_token

        session_t0 = time.time()
        session_span = _tracer.start_span(
            "voice_session", attributes={"user_id": user_id}
        )

        logger.info("[FLOW] Step 5 START — creating VoiceSession [user=%s]", user_id)

        # ── Step 2: Create session + out_queue ───────────────────────────
        from server.voice_session import VoiceSession
        out_queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        try:
            session = VoiceSession(
                user_id=user_id,
                auth_token=auth_token,
                patient_context=patient_context,
                out_queue=out_queue,
                loop=loop,
                piper_fillers=self._piper_fillers,
                tts_synth=self._tts_synth,
            )
        except Exception as exc:
            logger.exception("[FLOW] VoiceSession init failed")
            session_span.set_status(otel_trace.StatusCode.ERROR, str(exc))
            session_span.end()
            yield voice_pb2.ServerMessage(
                error=voice_pb2.SessionError(message=f"Session init failed: {exc}")
            )
            return

        logger.info("[FLOW] Step 5 DONE — VoiceSession ready (%.0fms)", (time.time() - session_t0) * 1000)

        # ── Step 3: Signal ready ─────────────────────────────────────────
        yield voice_pb2.ServerMessage(ready=voice_pb2.SessionReady())

        # ── Step 4a: Input pump — gRPC frames → VoiceSession methods ─────
        async def forward_input_task() -> None:
            try:
                async for msg in request_iterator:
                    if msg.HasField("audio"):
                        await session.on_audio_chunk(msg.audio.data)
                    elif msg.HasField("end_of_utterance"):
                        logger.info("[VOICE forward] end_of_utterance")
                        await session.on_audio_stream_end()
                    elif msg.HasField("text"):
                        await session.on_text(msg.text.text)
                    elif msg.HasField("end"):
                        break
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.exception("[VOICE forward] input loop error")
            finally:
                # Drain signal — stop the output pump.
                await out_queue.put(_DONE)

        # ── Step 4b: Trigger the opening greeting ────────────────────────
        await session.start()

        # ── Step 5: Output pump — out_queue → gRPC yield ─────────────────
        input_task = asyncio.create_task(forward_input_task())
        msg_count = 0
        try:
            while True:
                item = await out_queue.get()
                if item is _DONE:
                    logger.info("[FLOW] Session DONE — %d messages yielded (%.0fms total)",
                                msg_count, (time.time() - session_t0) * 1000)
                    break
                msg_count += 1
                field = item.WhichOneof("payload") if hasattr(item, "WhichOneof") else "?"
                if field == "audio":
                    if _VOICE_DEBUG:
                        logger.info("[VOICE yield] #%d field=audio bytes=%d", msg_count, len(item.audio.data))
                else:
                    logger.info("[VOICE yield] #%d field=%s", msg_count, field)
                yield item
        except asyncio.CancelledError:
            logger.info("[VOICE yield] cancelled after %d messages", msg_count)
        finally:
            input_task.cancel()
            session_span.end()
            try:
                provider = otel_trace.get_tracer_provider()
                if hasattr(provider, "force_flush"):
                    provider.force_flush(timeout_millis=5000)
            except Exception:
                pass
            logger.info("Voice session ended [user=%s]", user_id)

        yield voice_pb2.ServerMessage(closed=voice_pb2.SessionClosed())
