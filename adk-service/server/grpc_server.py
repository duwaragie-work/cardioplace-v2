"""
gRPC servicer for the Cardioplace voice agent.

Each call to StreamSession:
  1. Reads the first ClientMessage (must be SessionInit).
  2. Creates an ADK Runner + session for that user.
  3. Starts two concurrent async tasks:
     - forward_input: reads AudioChunk / TextInput / EndOfUtterance from the
                      gRPC stream and pushes them into the ADK LiveRequestQueue.
     - run_agent:     runs runner.run_live() and converts events to
                      ServerMessages, putting them into out_queue.
  4. Yields ServerMessages from out_queue until the session ends.
"""

import asyncio
import logging
import os
import time
from typing import AsyncIterator

_VOICE_DEBUG = os.getenv("VOICE_DEBUG", "") == "1"
_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-native-audio-latest")

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

    # ── 0. Tool call detection (log only — tool function emits the ActionNotice
    #       itself with richer detail; mapper-side emission would duplicate it)
    func_calls = getattr(event, "get_function_calls", lambda: [])()
    sc_dbg = getattr(event, "server_content", None)
    tc_dbg = bool(getattr(sc_dbg, "turn_complete", False)) if sc_dbg else False
    # Log at INFO only for "interesting" events (has function call or turn_complete).
    # Plain audio/text-chunk events fire per-frame and would flood the log.
    if func_calls or tc_dbg or _VOICE_DEBUG:
        logger.info(
            "[VOICE map] event func_calls=%d has_server_content=%s has_content=%s turn_complete=%s",
            len(func_calls),
            sc_dbg is not None,
            getattr(event, "content", None) is not None,
            tc_dbg,
        )
    for fc in func_calls:
        tool_name = getattr(fc, "name", "") or ""
        logger.info("[VOICE map] function_call detected: %s (tool emits its own ActionNotice)", tool_name)

    # ── 0b. User/agent speech transcriptions (Gemini 2.5+ emits these at
    #        top level on Event, not inside server_content).
    input_tx = getattr(event, "input_transcription", None)
    if input_tx:
        tx_text = getattr(input_tx, "text", "") or ""
        if tx_text.strip():
            logger.info("[VOICE tx] user=%r finished=%s", tx_text[:60], getattr(input_tx, "finished", False))
            messages.append(
                voice_pb2.ServerMessage(
                    transcript=voice_pb2.Transcript(
                        text=tx_text,
                        is_final=bool(getattr(input_tx, "finished", False)),
                        speaker="user",
                    )
                )
            )
    output_tx = getattr(event, "output_transcription", None)
    if output_tx:
        tx_text = getattr(output_tx, "text", "") or ""
        if tx_text.strip():
            logger.info("[VOICE tx] agent=%r finished=%s", tx_text[:60], getattr(output_tx, "finished", False))
            messages.append(
                voice_pb2.ServerMessage(
                    transcript=voice_pb2.Transcript(
                        text=tx_text,
                        is_final=bool(getattr(output_tx, "finished", False)),
                        speaker="agent",
                    )
                )
            )

    # ── 1. Audio / text content ──────────────────────────────────────────
    # Check BOTH server_content.model_turn and content — Gemini 2.5 native-audio
    # delivers agent audio on `event.content.parts[].inline_data`, while 2.0
    # delivers it on `server_content.model_turn.parts`. The old `if sc: elif
    # content:` structure skipped `content` whenever sc was a non-null empty
    # object, which is exactly the native-audio case (audio never surfaced).
    # Dedup is unnecessary in practice because a given event populates one
    # path, not both.
    sc = getattr(event, "server_content", None)
    content = getattr(event, "content", None)
    seen_audio_ids: set[int] = set()

    def _extract_parts(parts, *, speaker: str = "agent") -> None:
        for part in parts or []:
            inline = getattr(part, "inline_data", None)
            if inline and getattr(inline, "data", None):
                mime = getattr(inline, "mime_type", "") or ""
                if "audio" in mime and id(inline.data) not in seen_audio_ids:
                    seen_audio_ids.add(id(inline.data))
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
                            speaker=speaker,
                        )
                    )
                )

    if sc is not None:
        model_turn = getattr(sc, "model_turn", None)
        if model_turn is not None:
            _extract_parts(getattr(model_turn, "parts", []) or [])

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

    if content is not None:
        _extract_parts(getattr(content, "parts", []) or [])

    # ── 2. Event-level turn_complete (2.5 native-audio puts it here, not on sc)
    if getattr(event, "turn_complete", False):
        messages.append(
            voice_pb2.ServerMessage(
                transcript=voice_pb2.Transcript(
                    text="",
                    is_final=True,
                    speaker="agent",
                )
            )
        )

    # Log what was extracted — promoted from debug so post-tool silence is visible.
    # Pure-audio events (the common case while Gemini is speaking) are only logged
    # when VOICE_DEBUG=1, since they arrive every ~20-50ms and would flood Railway.
    if messages:
        fields = [m.WhichOneof("payload") for m in messages]
        audio_only = all(f == "audio" for f in fields)
        if audio_only and not _VOICE_DEBUG:
            pass
        else:
            audio_bytes = sum(len(m.audio.data) for m in messages if m.HasField("audio"))
            logger.info(
                "[VOICE map] extracted %d msg(s): fields=%s audio_bytes=%d",
                len(messages),
                fields,
                audio_bytes,
            )
    else:
        # Empty events — dump the event's public attributes so we can see
        # exactly what Gemini is sending that we don't yet map.
        try:
            event_type = type(event).__name__
            attrs: dict[str, str] = {}
            for a in dir(event):
                if a.startswith("_"):
                    continue
                try:
                    v = getattr(event, a)
                except Exception:
                    continue
                if callable(v):
                    continue
                if v is None:
                    continue
                try:
                    if not v:
                        continue
                except Exception:
                    pass
                r = repr(v)
                if len(r) > 160:
                    r = r[:160] + "..."
                attrs[a] = r
            logger.info("[VOICE map] extracted 0 msg(s) — event_type=%s attrs=%s", event_type, attrs)
        except Exception as dump_exc:
            logger.info("[VOICE map] extracted 0 msg(s) — (dump failed: %s)", dump_exc)

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

        # Shared state for latency instrumentation — both run_agent_task and
        # forward_input_task stamp "user_final_at" so the first agent audio
        # chunk can compute user→agent latency regardless of which signal (the
        # input_transcription finished flag or the client VAD end_of_utterance)
        # arrived first.
        turn_state: dict[str, float | None] = {"user_final_at": None}

        # ── Step 3: Signal ready ──────────────────────────────────────────
        logger.info("[FLOW] Step 5 — sending SessionReady (%.0fms)", (time.time() - session_t0) * 1000)
        yield voice_pb2.ServerMessage(ready=voice_pb2.SessionReady())

        # ── Step 4a: Task — run ADK agent, push events to out_queue ───────
        async def run_agent_task() -> None:
            try:
                # Config varies by model era:
                # - 2.0 Live (legacy): needs NO_INTERRUPTION to keep post-tool
                #   audio from being cancelled by mic VAD.
                # - 2.5 native-audio / 3.1+ (current): reject the realtime_input_config
                #   field, require input/output_audio_transcription to treat audio as
                #   speech at all. Also pin input ASR to en-US so it doesn't drift
                #   to Hindi/Telugu on accented English speech.
                is_legacy_2_0 = "2.0" in _GEMINI_MODEL
                if is_legacy_2_0:
                    run_config = RunConfig(
                        response_modalities=["AUDIO"],
                        realtime_input_config=genai_types.RealtimeInputConfig(
                            activity_handling=genai_types.ActivityHandling.NO_INTERRUPTION,
                        ),
                    )
                    logger.info("[Config] RunConfig: modalities=AUDIO, activity_handling=NO_INTERRUPTION (2.0 model)")
                else:
                    run_config = RunConfig(
                        response_modalities=["AUDIO"],
                        input_audio_transcription=genai_types.AudioTranscriptionConfig(),
                        output_audio_transcription=genai_types.AudioTranscriptionConfig(),
                        speech_config=genai_types.SpeechConfig(language_code="en-US"),
                    )
                    logger.info("[Config] RunConfig: modalities=AUDIO + in/out transcription + language=en-US (non-2.0 model: %s)", _GEMINI_MODEL)
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

                    # Stamp the user-turn end when input_transcription finalises.
                    # forward_input_task also stamps on end_of_utterance (earlier
                    # anchor for 2.5 native-audio where transcription lags audio).
                    in_tx = getattr(event, "input_transcription", None)
                    if in_tx is not None and getattr(in_tx, "finished", False):
                        tx_text = getattr(in_tx, "text", "") or ""
                        if tx_text.strip():
                            turn_state["user_final_at"] = time.time()

                    mapped = _map_event(event)
                    for msg in mapped:
                        if msg.HasField("audio"):
                            audio_chunk_count += 1
                            # Log once per agent turn — the gap from user-final
                            # to this first audio chunk is Gemini's think+speak time.
                            if turn_state["user_final_at"] is not None:
                                dt_ms = (time.time() - turn_state["user_final_at"]) * 1000
                                logger.info(
                                    "[VOICE latency] model_first_audio dt_since_user_final=%.0fms",
                                    dt_ms,
                                )
                                turn_state["user_final_at"] = None
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
                logger.info("[VOICE run_agent] cancelled — events=%d tool_calls=%d audio=%d", event_count, tool_call_count, audio_chunk_count)
                pass
            except APIError as exc:
                logger.info("[VOICE run_agent] APIError code=%s msg=%s events=%d tool_calls=%d audio=%d", exc.code, str(exc)[:200], event_count, tool_call_count, audio_chunk_count)
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
                logger.exception("[VOICE run_agent] unexpected error events=%d tool_calls=%d audio=%d", event_count, tool_call_count, audio_chunk_count)
                await out_queue.put(
                    voice_pb2.ServerMessage(
                        error=voice_pb2.SessionError(message=str(exc))
                    )
                )
            finally:
                logger.info("[VOICE run_agent] DONE — events=%d tool_calls=%d audio=%d", event_count, tool_call_count, audio_chunk_count)
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
                    elif msg.HasField("end_of_utterance"):
                        # Client-side VAD says user paused. Relay a sentinel
                        # Blob that main.py's _patched_send_realtime recognises
                        # and converts into send_realtime_input(audio_stream_end=True).
                        # ADK's LiveRequestQueue has no native path for this signal,
                        # hence the sentinel routing.
                        logger.info("[VOICE forward] end_of_utterance received — relaying to Gemini")
                        # Use this as the latency anchor for the CURRENT turn.
                        # It's a better stamp than input_transcription.finished
                        # (which 2.5 native-audio emits *after* the agent has
                        # already started responding, making the metric stale).
                        turn_state["user_final_at"] = time.time()
                        live_queue.send_realtime(
                            genai_types.Blob(
                                data=b"",
                                mime_type="application/x-audio-stream-end",
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
                field = item.WhichOneof("payload") if hasattr(item, "WhichOneof") else "?"
                # Audio chunks arrive every ~20-50ms; gate per-chunk yield logs behind VOICE_DEBUG
                if field == "audio":
                    if _VOICE_DEBUG:
                        logger.info("[VOICE yield] #%d field=audio bytes=%d", msg_count, len(item.audio.data))
                else:
                    logger.info("[VOICE yield] #%d field=%s", msg_count, field)
                yield item
        except asyncio.CancelledError:
            logger.info("[VOICE yield] cancelled after %d messages", msg_count)
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
