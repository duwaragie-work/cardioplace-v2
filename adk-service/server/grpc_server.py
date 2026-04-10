"""
gRPC servicer for the Cardioplace voice agent.

Each call to StreamSession:
  1. Reads the first ClientMessage (must be SessionInit).
  2. Creates an ADK Runner + session for that user.
  3. Starts two concurrent async tasks:
     - forward_input: reads AudioChunk / TextInput from the gRPC stream
                      and pushes them into the ADK LiveRequestQueue.
     - run_agent:     runs runner.run_live() and converts events to
                      ServerMessages, putting them into out_queue.
  4. Yields ServerMessages from out_queue until the session ends.
"""

import asyncio
import logging
import time
from typing import AsyncIterator

from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig
from google.genai import types as genai_types
from google.genai.errors import APIError
from grpc import aio

from opentelemetry import trace as otel_trace

from agent.cardio_agent import create_session_runner, APP_NAME
from generated import voice_pb2, voice_pb2_grpc

logger = logging.getLogger(__name__)
_tracer = otel_trace.get_tracer("healplace.voice")

# Sentinel that signals run_agent task has finished
_DONE = object()


def _map_event(event) -> list[voice_pb2.ServerMessage]:
    """
    Convert one ADK event into zero or more ServerMessage protos.

    Transcription is handled separately by the NestJS backend (post-session),
    so we only extract audio/text content and tool call notifications here.
    """
    messages: list[voice_pb2.ServerMessage] = []

    # ── 0. Tool call events — notify frontend BEFORE tool executes ─────
    func_calls = getattr(event, "get_function_calls", lambda: [])()
    for fc in func_calls:
        tool_name = getattr(fc, "name", "") or ""
        action_map = {
            "submit_checkin": "submitting_checkin",
            "get_recent_readings": "fetching_readings",
            "update_checkin": "updating_checkin",
            "delete_checkin": "deleting_checkin",
        }
        action_type = action_map.get(tool_name)
        if action_type:
            messages.append(
                voice_pb2.ServerMessage(
                    action=voice_pb2.ActionNotice(
                        type=action_type,
                        detail=f"Tool call: {tool_name}",
                    )
                )
            )
            logger.info("[EVENT] Tool call detected: %s → action %s", tool_name, action_type)

    # ── 1. Audio / text content ──────────────────────────────────────────
    #    Prefer server_content (raw Gemini Live path); fall back to
    #    content (standard ADK path) to avoid duplicates.
    sc = getattr(event, "server_content", None)
    content = getattr(event, "content", None)

    if sc:
        model_turn = getattr(sc, "model_turn", None)
        if model_turn:
            for part in getattr(model_turn, "parts", []) or []:
                inline = getattr(part, "inline_data", None)
                if inline and getattr(inline, "data", None):
                    mime = getattr(inline, "mime_type", "") or ""
                    if "audio" in mime:
                        messages.append(
                            voice_pb2.ServerMessage(
                                audio=voice_pb2.AudioChunk(
                                    data=inline.data,
                                    mime_type=mime,
                                )
                            )
                        )
                text = getattr(part, "text", None)
                if text and str(text).strip():
                    messages.append(
                        voice_pb2.ServerMessage(
                            transcript=voice_pb2.Transcript(
                                text=str(text),
                                is_final=False,
                                speaker="agent",
                            )
                        )
                    )

        if getattr(sc, "turn_complete", False):
            messages.append(
                voice_pb2.ServerMessage(
                    transcript=voice_pb2.Transcript(
                        text="",
                        is_final=True,
                        speaker="agent",
                    )
                )
            )

    elif content:
        for part in getattr(content, "parts", []) or []:
            inline = getattr(part, "inline_data", None)
            if inline and getattr(inline, "data", None):
                mime = getattr(inline, "mime_type", "") or ""
                if "audio" in mime:
                    messages.append(
                        voice_pb2.ServerMessage(
                            audio=voice_pb2.AudioChunk(
                                data=inline.data,
                                mime_type=mime,
                            )
                        )
                    )
            text = getattr(part, "text", None)
            if text and str(text).strip():
                messages.append(
                    voice_pb2.ServerMessage(
                        transcript=voice_pb2.Transcript(
                            text=str(text),
                            is_final=False,
                            speaker="agent",
                        )
                    )
                )

    # Debug: log what was extracted
    transcript_msgs = [m for m in messages if m.HasField("transcript") and m.transcript.text.strip()]
    audio_msgs = [m for m in messages if m.HasField("audio")]
    if transcript_msgs:
        logger.debug("[EVENT] Extracted %d transcripts: %s", len(transcript_msgs), [(m.transcript.speaker, m.transcript.text[:50]) for m in transcript_msgs])
    if audio_msgs:
        logger.debug("[EVENT] Extracted %d audio chunks", len(audio_msgs))

    return messages


class VoiceAgentServicer(voice_pb2_grpc.VoiceAgentServicer):
    async def StreamSession(
        self,
        request_iterator: AsyncIterator[voice_pb2.ClientMessage],
        context: aio.ServicerContext,
    ):
        # ── Step 1: Read SessionInit ───────────────────────────────────────
        try:
            first = await request_iterator.__anext__()
        except StopAsyncIteration:
            return

        if not first.HasField("init"):
            yield voice_pb2.ServerMessage(
                error=voice_pb2.SessionError(
                    message="First message must be SessionInit"
                )
            )
            return

        init = first.init
        user_id = init.user_id
        mode = init.mode or "chat"
        patient_context = init.patient_context or "No context available."
        auth_token = init.auth_token
        language = init.language or "en-US"

        session_t0 = time.time()
        logger.info(
            "[FLOW] Step 5 START — creating AI agent [user=%s mode=%s]", user_id, mode
        )

        # ── Step 2: Create ADK runner + session ───────────────────────────
        loop = asyncio.get_running_loop()
        out_queue: asyncio.Queue = asyncio.Queue()
        live_queue = LiveRequestQueue()

        # Create a root span for the entire voice session
        session_span = _tracer.start_span(
            "voice_session",
            attributes={"user_id": user_id, "mode": mode},
        )
        session_ctx = otel_trace.set_span_in_context(session_span)

        try:
            runner, session_service = create_session_runner(
                user_id=user_id,
                mode=mode,
                patient_context=patient_context,
                auth_token=auth_token,
                out_queue=out_queue,
                loop=loop,
            )
            session = await session_service.create_session(
                app_name=APP_NAME, user_id=user_id
            )
            logger.info("[FLOW] Step 5 DONE — AI agent created (%.0fms)", (time.time() - session_t0) * 1000)
        except Exception as exc:
            logger.exception("[FLOW] Step 5 FAIL — AI agent creation failed (%.0fms)", (time.time() - session_t0) * 1000)
            logger.exception("Failed to create ADK session")
            session_span.set_status(otel_trace.StatusCode.ERROR, str(exc))
            session_span.end()
            yield voice_pb2.ServerMessage(
                error=voice_pb2.SessionError(message=f"Session init failed: {exc}")
            )
            return

        session_span.set_attribute("session_id", session.id)

        # ── Step 3: Signal ready ──────────────────────────────────────────
        logger.info("[FLOW] Step 5 — sending SessionReady (%.0fms)", (time.time() - session_t0) * 1000)
        yield voice_pb2.ServerMessage(ready=voice_pb2.SessionReady())

        # ── Step 4a: Task — run ADK agent, push events to out_queue ───────
        async def run_agent_task() -> None:
            try:
                run_config = RunConfig(
                    response_modalities=["AUDIO"],
                )
                logger.info("[Config] RunConfig: modalities=AUDIO, defaults")
                event_count = 0
                tool_call_count = 0
                audio_chunk_count = 0
                async for event in runner.run_live(
                    user_id=user_id,
                    session_id=session.id,
                    live_request_queue=live_queue,
                    run_config=run_config,
                ):
                    event_count += 1
                    mapped = _map_event(event)
                    for msg in mapped:
                        if msg.HasField("audio"):
                            audio_chunk_count += 1
                        elif msg.HasField("action"):
                            tool_call_count += 1
                            with _tracer.start_span(
                                f"tool_call {msg.action.type}",
                                context=session_ctx,
                            ) as tc_span:
                                tc_span.set_attribute("tool.type", msg.action.type)
                                tc_span.set_attribute("tool.detail", msg.action.detail)
                        await out_queue.put(msg)
            except asyncio.CancelledError:
                pass
            except APIError as exc:
                if exc.code == 1000:
                    session_span.set_status(otel_trace.StatusCode.OK)
                    session_span.set_attribute("events_total", event_count)
                    session_span.set_attribute("audio_chunks", audio_chunk_count)
                    session_span.set_attribute("tool_calls", tool_call_count)
                    logger.info("Voice session closed normally [user=%s]", user_id)
                    await out_queue.put(
                        voice_pb2.ServerMessage(
                            error=voice_pb2.SessionError(
                                message="Voice session ended — maximum duration reached. Please start a new session."
                            )
                        )
                    )
                else:
                    logger.exception("run_live API error [code=%s]", exc.code)
                    await out_queue.put(
                        voice_pb2.ServerMessage(
                            error=voice_pb2.SessionError(message=str(exc))
                        )
                    )
            except Exception as exc:
                logger.exception("run_live error")
                await out_queue.put(
                    voice_pb2.ServerMessage(
                        error=voice_pb2.SessionError(message=str(exc))
                    )
                )
            finally:
                await out_queue.put(_DONE)

        # ── Step 4b: Task — forward client input to live_queue ────────────
        async def forward_input_task() -> None:
            try:
                async for msg in request_iterator:
                    if msg.HasField("audio"):
                        live_queue.send_realtime(
                            genai_types.Blob(
                                data=msg.audio.data,
                                mime_type=msg.audio.mime_type or "audio/pcm;rate=16000",
                            )
                        )
                    elif msg.HasField("text"):
                        live_queue.send_content(
                            content=genai_types.Content(
                                role="user",
                                parts=[genai_types.Part(text=msg.text.text)],
                            )
                        )
                    elif msg.HasField("end"):
                        break
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.exception("forward_input error")
            finally:
                live_queue.close()

        agent_task = asyncio.create_task(run_agent_task())
        input_task = asyncio.create_task(forward_input_task())

        # ── Trigger the agent to speak first ─────────────────────────────
        live_queue.send_content(
            content=genai_types.Content(
                role="user",
                parts=[genai_types.Part(text="[Session started]")],
            )
        )

        # ── Step 5: Yield from out_queue until done ───────────────────────
        msg_count = 0
        try:
            while True:
                item = await out_queue.get()
                if item is _DONE:
                    logger.info("[FLOW] Session DONE — %d messages yielded (%.0fms total)", msg_count, (time.time() - session_t0) * 1000)
                    break
                msg_count += 1
                yield item
        except asyncio.CancelledError:
            pass
        finally:
            agent_task.cancel()
            input_task.cancel()
            live_queue.close()
            # End the session span and flush to LangSmith
            session_span.end()
            try:
                provider = otel_trace.get_tracer_provider()
                if hasattr(provider, 'force_flush'):
                    provider.force_flush(timeout_millis=5000)
            except Exception:
                pass
            logger.info("Voice session ended [user=%s]", user_id)

        yield voice_pb2.ServerMessage(closed=voice_pb2.SessionClosed())
