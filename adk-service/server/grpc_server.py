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

from agent.cardio_agent import create_session_runner, APP_NAME
from generated import voice_pb2, voice_pb2_grpc

logger = logging.getLogger(__name__)

# Sentinel that signals run_agent task has finished
_DONE = object()


def _map_event(event) -> list[voice_pb2.ServerMessage]:
    """
    Convert one ADK event into zero or more ServerMessage protos.

    Transcription events arrive as top-level fields on the ADK Event
    (event.input_transcription / event.output_transcription), NOT inside
    event.server_content.  Audio and text content come through either
    event.server_content (preferred) or event.content (fallback).
    """
    messages: list[voice_pb2.ServerMessage] = []

    # ── 1. Transcription events (top-level on ADK Event) ─────────────────
    #    The ADK sets these directly on the event and returns early,
    #    so server_content / content are NOT populated for these events.
    input_tx = getattr(event, "input_transcription", None)
    if input_tx:
        tx_text = getattr(input_tx, "text", None)
        if tx_text and str(tx_text).strip():
            messages.append(
                voice_pb2.ServerMessage(
                    transcript=voice_pb2.Transcript(
                        text=str(tx_text),
                        is_final=True,
                        speaker="user",
                    )
                )
            )

    output_tx = getattr(event, "output_transcription", None)
    if output_tx:
        tx_text = getattr(output_tx, "text", None)
        if tx_text and str(tx_text).strip():
            messages.append(
                voice_pb2.ServerMessage(
                    transcript=voice_pb2.Transcript(
                        text=str(tx_text),
                        is_final=True,
                        speaker="agent",
                    )
                )
            )

    # If we extracted transcription, this event is transcription-only — return early.
    if messages:
        logger.debug("[EVENT] Transcription: %s", [(m.transcript.speaker, m.transcript.text[:80]) for m in messages])
        return messages

    # ── 2. Audio / text content ──────────────────────────────────────────
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
            yield voice_pb2.ServerMessage(
                error=voice_pb2.SessionError(message=f"Session init failed: {exc}")
            )
            return

        # ── Step 3: Signal ready ──────────────────────────────────────────
        logger.info("[FLOW] Step 5 — sending SessionReady (%.0fms)", (time.time() - session_t0) * 1000)
        yield voice_pb2.ServerMessage(ready=voice_pb2.SessionReady())

        # ── Step 4a: Task — run ADK agent, push events to out_queue ───────
        async def run_agent_task() -> None:
            try:
                # Enable transcription so voice conversations are persisted.
                try:
                    _tx_config = genai_types.AudioTranscriptionConfig()
                except Exception as e:
                    logger.warning("AudioTranscriptionConfig failed — transcription disabled: %s", e)
                    _tx_config = None

                run_config = RunConfig(
                    response_modalities=["AUDIO"],
                    output_audio_transcription=_tx_config,
                    input_audio_transcription=_tx_config,
                    realtime_input_config=genai_types.RealtimeInputConfig(
                        automatic_activity_detection=genai_types.AutomaticActivityDetection(
                            start_of_speech_sensitivity=genai_types.StartSensitivity.START_SENSITIVITY_LOW,
                            end_of_speech_sensitivity=genai_types.EndSensitivity.END_SENSITIVITY_LOW,
                            prefix_padding_ms=600,
                            silence_duration_ms=1500,
                        ),
                    ),
                )
                logger.info("[Config] RunConfig: modalities=AUDIO, transcription=%s", "enabled" if _tx_config else "disabled")
                async for event in runner.run_live(
                    user_id=user_id,
                    session_id=session.id,
                    live_request_queue=live_queue,
                    run_config=run_config,
                ):
                    for msg in _map_event(event):
                        await out_queue.put(msg)
            except asyncio.CancelledError:
                pass
            except APIError as exc:
                if exc.code == 1000:
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
            logger.info("Voice session ended [user=%s]", user_id)

        yield voice_pb2.ServerMessage(closed=voice_pb2.SessionClosed())
