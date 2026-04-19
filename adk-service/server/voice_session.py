"""
Per-session voice state machine for the Groq/Cerebras/Piper stack.

Replaces the Google ADK Runner. One VoiceSession instance per gRPC connection.

Flow per turn:
  1. Frontend streams audio_chunk frames (16 kHz PCM) → buffered.
  2. Frontend (or server-side RMS VAD) signals end_of_utterance.
  3. If ENABLE_FILLER_ACK, stream a pre-synthesised filler onto out_queue
     immediately so the user hears something within ~150 ms.
  4. POST the buffered PCM to Groq Whisper → transcript.
  5. Append to chat history, call Cerebras Llama 3.3 with tool schemas
     (Groq Llama 3.3 as fallback if Cerebras 429s or times out).
  6. If the LLM returns tool_calls, dispatch to handlers (which emit their
     own ActionNotice/Checkin*/ActionComplete protos), append tool results,
     re-call LLM. Repeat until plain-text reply.
  7. Feed the reply text to Piper sentence-by-sentence; stream 24 kHz PCM
     chunks onto out_queue; the gRPC server pumps them back to the frontend.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import random
import re
import time
import wave
from typing import Any

logger = logging.getLogger(__name__)

# ── Config via env ────────────────────────────────────────────────────────────
GROQ_ASR_MODEL = os.getenv("GROQ_ASR_MODEL", "whisper-large-v3-turbo")
CEREBRAS_LLM_MODEL = os.getenv("CEREBRAS_LLM_MODEL", "llama-3.3-70b")
GROQ_LLM_MODEL = os.getenv("GROQ_LLM_MODEL", "llama-3.3-70b-versatile")
LLM_FALLBACK_GROQ = os.getenv("LLM_FALLBACK_GROQ", "true").lower() == "true"
ENABLE_FILLER_ACK = os.getenv("ENABLE_FILLER_ACK", "true").lower() == "true"
CEREBRAS_FIRST_TOKEN_TIMEOUT_S = 0.8

USER_SAMPLE_RATE = 16000  # frontend mic rate
AGENT_SAMPLE_RATE = 24000  # frontend playback rate (Piper resampled in piper_tts.py)

# Reasonable chunk size for streaming agent audio back to the frontend.
# The frontend's playback scheduler queues and plays each chunk as it arrives.
AGENT_CHUNK_BYTES = 4800  # 100 ms of 24 kHz mono int16


# ── Clients (lazy) ────────────────────────────────────────────────────────────
_groq_client = None
_cerebras_client = None
# Process-wide circuit breaker. If Cerebras returns a persistent error (404
# means wrong model id / deprecated endpoint; 401/403 means bad key), we stop
# trying it for the rest of this process lifetime and go straight to Groq —
# saves ~400 ms per turn.
_cerebras_disabled = False
_cerebras_disabled_reason: str | None = None


def _get_groq():
    global _groq_client
    if _groq_client is None:
        from groq import Groq
        _groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))
    return _groq_client


def _get_cerebras():
    global _cerebras_client
    if _cerebras_client is None:
        from cerebras.cloud.sdk import Cerebras
        _cerebras_client = Cerebras(api_key=os.getenv("CEREBRAS_API_KEY"))
    return _cerebras_client


# ── Session ───────────────────────────────────────────────────────────────────
class VoiceSession:
    """
    One instance per gRPC StreamSession call. Holds chat history + audio
    buffer, drives the ASR/LLM/TTS pipeline, emits ServerMessage protos onto
    `out_queue` for the gRPC server to pump back to NestJS.
    """

    def __init__(
        self,
        user_id: str,
        auth_token: str,
        patient_context: str,
        out_queue: asyncio.Queue,
        loop: asyncio.AbstractEventLoop,
        piper_fillers: list[bytes],
        tts_synth,  # callable(text: str) -> SynthResult, provided by main
    ) -> None:
        self.user_id = user_id
        self.auth_token = auth_token
        self.patient_context = patient_context
        self.out_queue = out_queue
        self.loop = loop
        self.piper_fillers = piper_fillers
        self._tts_synth = tts_synth

        # Mic buffer accumulates raw 16 kHz int16 PCM bytes.
        self._mic_buf = bytearray()
        # Lock so on_audio_stream_end doesn't race with on_audio_chunk.
        self._mic_lock = asyncio.Lock()
        # Busy flag — one turn at a time; ignore new VAD signals mid-turn.
        self._turn_in_flight = False

        # Chat history (OpenAI-format). System prompt + patient context
        # injected once; live conversation appended turn-by-turn.
        system_prompt = self._build_system_prompt(patient_context)
        self._history: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
        ]

        # Tool handlers (bound to this session's auth + emit closure).
        from agent.groq_tools import make_handlers, TOOL_SCHEMAS
        self._tool_schemas = TOOL_SCHEMAS
        self._tool_handlers = make_handlers(
            auth_token=auth_token,
            emit=self._emit,
        )

        # Per-turn latency anchors.
        self._user_turn_end_at: float | None = None
        self._latency_log_done_for_turn = False

    # ── Helpers ──────────────────────────────────────────────────────────
    @staticmethod
    def _build_system_prompt(patient_context: str) -> str:
        """
        Build the system prompt. Imports lazily so proto generation and
        env loading happen before this call.
        """
        from agent.prompts import build_prompt
        return build_prompt("chat", patient_context)

    def _emit(self, msg: Any) -> None:
        """Thread-safe put onto the async out_queue (called from handlers)."""
        asyncio.run_coroutine_threadsafe(self.out_queue.put(msg), self.loop)

    async def _emit_async(self, msg: Any) -> None:
        await self.out_queue.put(msg)

    # ── Public API (called by grpc_server.py) ────────────────────────────
    async def on_audio_chunk(self, pcm_bytes: bytes) -> None:
        async with self._mic_lock:
            self._mic_buf.extend(pcm_bytes)

    async def on_audio_stream_end(self) -> None:
        """
        Fired when the client-side VAD says the user stopped talking. Kick
        off the turn pipeline.
        """
        if self._turn_in_flight:
            # Still finishing the previous turn — ignore this signal (prevents
            # double-taps from rapid pauses).
            logger.info("[SESSION] end_of_utterance ignored (turn in flight)")
            return
        async with self._mic_lock:
            if len(self._mic_buf) < USER_SAMPLE_RATE * 2 // 4:  # < 250 ms
                logger.info("[SESSION] end_of_utterance ignored (buffer <250ms)")
                return
            pcm = bytes(self._mic_buf)
            self._mic_buf.clear()

        self._turn_in_flight = True
        self._user_turn_end_at = time.time()
        self._latency_log_done_for_turn = False
        # Fire-and-forget the turn — don't block the gRPC input loop.
        asyncio.create_task(self._run_turn(pcm))

    async def on_text(self, text: str) -> None:
        """Fallback: user typed text instead of speaking."""
        if self._turn_in_flight:
            return
        self._turn_in_flight = True
        self._user_turn_end_at = time.time()
        self._latency_log_done_for_turn = False
        asyncio.create_task(self._run_turn_from_text(text))

    async def start(self) -> None:
        """
        Greet the patient on session start. Runs once after init so the user
        hears "Hi <name>, how can I help?" without having to speak first.
        """
        self._turn_in_flight = True
        self._user_turn_end_at = None  # no user-turn-end on the greeting
        asyncio.create_task(self._run_greeting())

    # ── Turn pipeline ────────────────────────────────────────────────────
    async def _run_turn(self, pcm_bytes: bytes) -> None:
        t_turn_start = time.time()
        try:
            # 1. Filler-ack masks the compute time.
            if ENABLE_FILLER_ACK and self.piper_fillers:
                filler_pcm = random.choice(self.piper_fillers)
                await self._stream_agent_audio(filler_pcm)

            # 2. ASR
            t_asr = time.time()
            transcript = await asyncio.to_thread(self._transcribe_whisper, pcm_bytes)
            asr_ms = (time.time() - t_asr) * 1000
            logger.info("[LATENCY] asr_ms=%.0f text=%r", asr_ms, transcript[:60])

            if not transcript.strip():
                logger.info("[SESSION] empty transcript — aborting turn")
                return

            # Emit user transcript (frontend shows it in the UI).
            await self._emit_user_transcript(transcript)

            self._history.append({"role": "user", "content": transcript})

            # 3. LLM + tool dispatch
            await self._run_agent_turn(t_asr)
        except Exception:
            logger.exception("[SESSION] turn pipeline failed")
            from generated import voice_pb2
            await self._emit_async(
                voice_pb2.ServerMessage(
                    error=voice_pb2.SessionError(message="Turn failed — please try again.")
                )
            )
        finally:
            self._turn_in_flight = False
            logger.info("[LATENCY] total_turn_ms=%.0f", (time.time() - t_turn_start) * 1000)

    async def _run_turn_from_text(self, text: str) -> None:
        try:
            await self._emit_user_transcript(text)
            self._history.append({"role": "user", "content": text})
            await self._run_agent_turn(time.time())
        except Exception:
            logger.exception("[SESSION] text-turn failed")
        finally:
            self._turn_in_flight = False

    async def _run_greeting(self) -> None:
        try:
            # Pseudo user message triggers the greeting rule in the prompt.
            self._history.append({"role": "user", "content": "[Session started]"})
            await self._run_agent_turn(time.time(), log_latency=False)
        except Exception:
            logger.exception("[SESSION] greeting failed")
        finally:
            self._turn_in_flight = False

    # ── LLM loop ─────────────────────────────────────────────────────────
    async def _run_agent_turn(self, t_pre_llm: float, log_latency: bool = True) -> None:
        """
        Call the LLM; if it returns tool_calls, dispatch them synchronously,
        append results to history, re-call LLM. Loop until a plain-text reply.
        Stream the final text to Piper.
        """
        max_hops = 4  # prevent infinite loops
        for hop in range(max_hops):
            t_llm = time.time()
            msg = await asyncio.to_thread(self._call_llm_with_tools)
            llm_ms = (time.time() - t_llm) * 1000
            logger.info("[LATENCY] llm_first_token_ms=%.0f hop=%d", llm_ms, hop)

            tool_calls = msg.get("tool_calls") or []
            if tool_calls:
                # Record the assistant's tool_call message verbatim; Llama
                # expects the full object in history for follow-up calls.
                self._history.append({
                    "role": "assistant",
                    "content": msg.get("content") or "",
                    "tool_calls": tool_calls,
                })
                for tc in tool_calls:
                    name = tc["function"]["name"]
                    raw_args = tc["function"].get("arguments") or "{}"
                    try:
                        args = json.loads(raw_args)
                    except json.JSONDecodeError:
                        logger.warning("[LLM] tool %s sent bad JSON: %r", name, raw_args)
                        args = {}
                    handler = self._tool_handlers.get(name)
                    if handler is None:
                        logger.warning("[LLM] unknown tool %s", name)
                        result = {"error": f"unknown tool {name}"}
                    else:
                        result = await asyncio.to_thread(handler, args)
                    self._history.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "name": name,
                        "content": json.dumps(result),
                    })
                # Loop to let the LLM produce the follow-up natural-language reply.
                continue

            # No tool call — this is the user-facing reply.
            reply_text = (msg.get("content") or "").strip()
            self._history.append({"role": "assistant", "content": reply_text})
            if not reply_text:
                return
            await self._speak(reply_text, log_latency=log_latency)
            return

        logger.warning("[LLM] max_hops reached without plain-text reply")

    def _call_llm_with_tools(self) -> dict:
        """
        Try Cerebras first, fall back to Groq on 429 / timeout / error.
        Returns the first assistant message object (OpenAI chat format).
        Blocking — call from asyncio.to_thread.
        """
        global _cerebras_disabled, _cerebras_disabled_reason

        if not _cerebras_disabled and os.getenv("CEREBRAS_API_KEY"):
            try:
                client = _get_cerebras()
                resp = client.chat.completions.create(
                    model=CEREBRAS_LLM_MODEL,
                    messages=self._history,
                    tools=self._tool_schemas,
                    tool_choice="auto",
                    parallel_tool_calls=False,
                    timeout=CEREBRAS_FIRST_TOKEN_TIMEOUT_S + 3,
                )
                m = resp.choices[0].message
                return _msg_to_dict(m)
            except Exception as exc:
                status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
                # Log the actual response body so we can diagnose 404 (model id
                # wrong/deprecated), 401/403 (key rejected), or 429 (rate limit).
                body = ""
                try:
                    body = str(getattr(exc, "response", None).text) if getattr(exc, "response", None) else ""
                except Exception:
                    pass
                logger.warning(
                    "[LLM] Cerebras failed (%s status=%s body=%r); falling back to Groq",
                    type(exc).__name__, status, body[:200],
                )
                # 404/401/403 = persistent config issue. Flip the breaker so we
                # stop wasting 300-500 ms per turn on a call we know will fail.
                if status in (400, 401, 403, 404):
                    _cerebras_disabled = True
                    _cerebras_disabled_reason = f"status={status} after first attempt"
                    logger.warning(
                        "[LLM] Cerebras disabled for remainder of process: %s",
                        _cerebras_disabled_reason,
                    )
                if not LLM_FALLBACK_GROQ:
                    raise

        # Groq fast path (either Cerebras was skipped or it just failed).
        client = _get_groq()
        resp = client.chat.completions.create(
            model=GROQ_LLM_MODEL,
            messages=self._history,
            tools=self._tool_schemas,
            tool_choice="auto",
        )
        m = resp.choices[0].message
        return _msg_to_dict(m)

    # ── ASR ──────────────────────────────────────────────────────────────
    def _transcribe_whisper(self, pcm_bytes: bytes) -> str:
        """
        POST raw 16 kHz PCM (wrapped in a WAV container) to Groq Whisper.
        language='en' prevents the Hindi/Telugu drift we saw on Gemini's ASR.
        Blocking — call from asyncio.to_thread.
        """
        # Wrap raw PCM in a minimal WAV header; Groq's Whisper accepts WAV.
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav_out:
            wav_out.setnchannels(1)
            wav_out.setsampwidth(2)
            wav_out.setframerate(USER_SAMPLE_RATE)
            wav_out.writeframes(pcm_bytes)
        buf.seek(0)

        client = _get_groq()
        # Domain prompt — biases Whisper toward medical vocabulary and away
        # from the weird free-form hallucinations we saw ("Did it blood
        # pressure", "ersonic like hot water"). Max 224 tokens per Groq docs.
        asr_prompt = (
            "The speaker is a patient discussing blood pressure readings, "
            "medications, and symptoms. Common words: blood pressure, systolic, "
            "diastolic, medication, headache, dizziness, chest tightness. "
            "Numbers are spoken as 'one hundred twenty over eighty'."
        )
        resp = client.audio.transcriptions.create(
            file=("audio.wav", buf, "audio/wav"),
            model=GROQ_ASR_MODEL,
            language="en",
            prompt=asr_prompt,
            temperature=0.0,  # deterministic; prevents invented words
        )
        # Groq returns an object with .text (or a dict with 'text').
        return getattr(resp, "text", "") or (resp.get("text") if isinstance(resp, dict) else "") or ""

    # ── TTS streaming ────────────────────────────────────────────────────
    async def _speak(self, text: str, log_latency: bool = True) -> None:
        """
        Synthesise `text` with Piper, split by sentence so the first audio
        byte goes out as soon as the first sentence finishes (rather than
        waiting for the whole reply). Each sentence's PCM is chunked into
        AGENT_CHUNK_BYTES-sized ServerMessage(audio=...) protos.
        """
        sentences = _split_sentences(text)
        first_byte_logged = False
        for s in sentences:
            if not s.strip():
                continue
            t_tts = time.time()
            result = await asyncio.to_thread(self._tts_synth, s)
            tts_ms = (time.time() - t_tts) * 1000
            logger.info("[LATENCY] tts_first_byte_ms=%.0f sent=%r", tts_ms, s[:40])
            await self._stream_agent_audio(result.pcm_24k)
            if not first_byte_logged and log_latency and self._user_turn_end_at:
                total = (time.time() - self._user_turn_end_at) * 1000
                logger.info("[LATENCY] user_end→agent_first_audio=%.0fms", total)
                first_byte_logged = True

    async def _stream_agent_audio(self, pcm_24k: bytes) -> None:
        """Chunk raw PCM into AGENT_CHUNK_BYTES and emit audio ServerMessages."""
        from generated import voice_pb2
        for i in range(0, len(pcm_24k), AGENT_CHUNK_BYTES):
            chunk = pcm_24k[i : i + AGENT_CHUNK_BYTES]
            await self._emit_async(
                voice_pb2.ServerMessage(
                    audio=voice_pb2.AudioChunk(
                        data=chunk,
                        mime_type=f"audio/pcm;rate={AGENT_SAMPLE_RATE}",
                    )
                )
            )

    async def _emit_user_transcript(self, text: str) -> None:
        from generated import voice_pb2
        await self._emit_async(
            voice_pb2.ServerMessage(
                transcript=voice_pb2.Transcript(
                    text=text,
                    is_final=True,
                    speaker="user",
                )
            )
        )


# ── Module helpers ────────────────────────────────────────────────────────────
def _split_sentences(text: str) -> list[str]:
    """
    Cheap sentence splitter on .!? — good enough for short medical replies.
    Keeps punctuation with the sentence.
    """
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [p for p in parts if p.strip()]


def _msg_to_dict(m: Any) -> dict:
    """
    Normalise OpenAI-compatible assistant messages from Groq / Cerebras SDKs
    into a plain dict with {content, tool_calls}.
    """
    content = getattr(m, "content", None)
    tool_calls = getattr(m, "tool_calls", None)
    tool_calls_out: list[dict] = []
    if tool_calls:
        for tc in tool_calls:
            tool_calls_out.append({
                "id": getattr(tc, "id", None),
                "type": getattr(tc, "type", "function"),
                "function": {
                    "name": getattr(tc.function, "name", ""),
                    "arguments": getattr(tc.function, "arguments", "{}"),
                },
            })
    return {"content": content, "tool_calls": tool_calls_out}
