"""
Cardioplace — ADK Voice Service
Entry point: starts the gRPC server and waits for connections.

Local dev:
    python main.py

Railway:
    CMD ["python", "main.py"]
"""

import asyncio
import logging
import os
import sys

from dotenv import load_dotenv

load_dotenv()

# ── Logging setup ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

# ── OpenTelemetry / LangSmith tracing ─────────────────────────────────────────
# ADK instruments agent invocations, LLM calls, and tool calls via OTEL.
# If OTEL_EXPORTER_OTLP_ENDPOINT is set, traces are exported to LangSmith.
if os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"):
    try:
        from google.adk.telemetry.setup import maybe_set_otel_providers
        maybe_set_otel_providers()
        logger.info("OpenTelemetry tracing enabled → %s", os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"))
    except Exception as e:
        logger.warning("Failed to set up OpenTelemetry tracing: %s", e)
else:
    logger.info("OpenTelemetry tracing disabled (OTEL_EXPORTER_OTLP_ENDPOINT not set)")

# ── Generate proto stubs if missing ──────────────────────────────────────────
import subprocess
import pathlib

_GENERATED = pathlib.Path("generated")
_PROTO = pathlib.Path("proto/voice.proto")
_PB2 = _GENERATED / "voice_pb2.py"

if not _PB2.exists():
    logger.info("Generating protobuf stubs…")
    _GENERATED.mkdir(exist_ok=True)
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "grpc_tools.protoc",
            "-I",
            "proto",
            "--python_out=generated",
            "--grpc_python_out=generated",
            str(_PROTO),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        logger.error("protoc failed:\n%s", result.stderr)
        sys.exit(1)
    logger.info("Protobuf stubs generated.")

# ── Add generated/ to sys.path so the bare `import voice_pb2` inside
#    the generated grpc stub resolves correctly ─────────────────────────────
sys.path.insert(0, str(_GENERATED.resolve()))

# ── Conditional patches for Gemini model compatibility ─────────────────────
# - gemini-2.0-flash-live-* uses the legacy `media_chunks` field; keep ADK
#   default send_realtime for that path.
# - gemini-2.5-flash-native-audio-* and gemini-3.1-flash-live-preview use the
#   new `audio=Blob` field on send_realtime_input; patch for those.
_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-live-preview")
_IS_LEGACY_2_0 = "2.0" in _GEMINI_MODEL
_IS_3_1 = "3.1" in _GEMINI_MODEL

from google.adk.models.gemini_llm_connection import GeminiLlmConnection
from google.genai import types as _genai_types

if not _IS_LEGACY_2_0:
    # Patch 1: send_realtime — use `audio` field instead of deprecated `media_chunks`.
    # Applied for any non-2.0 model (2.5 native-audio, 3.1, future).
    _original_send_realtime = GeminiLlmConnection.send_realtime
    _rt_chunk_count = {"n": 0}

    async def _patched_send_realtime(self, input):  # noqa: A002
        if isinstance(input, _genai_types.Blob):
            # Sentinel Blob from grpc_server.forward_input_task: client-side
            # VAD says user paused. Translate to Gemini Live's audio_stream_end
            # signal so the model finalises the user turn immediately instead
            # of waiting for its own silence detector.
            if input.mime_type == "application/x-audio-stream-end":
                try:
                    await self._gemini_session.send_realtime_input(audio_stream_end=True)
                    logger.info("[VOICE realtime] audio_stream_end=True sent to Gemini")
                except Exception as exc:
                    logger.warning("[VOICE realtime] audio_stream_end failed: %s", exc)
                return
            _rt_chunk_count["n"] += 1
            if _rt_chunk_count["n"] <= 3 or _rt_chunk_count["n"] % 50 == 0:
                logger.info(
                    "[VOICE realtime] chunk #%d mime=%s bytes=%d",
                    _rt_chunk_count["n"],
                    input.mime_type,
                    len(input.data) if input.data else 0,
                )
            await self._gemini_session.send_realtime_input(audio=input)
        else:
            logger.info("[VOICE realtime] non-blob input type=%s", type(input).__name__)
            await _original_send_realtime(self, input)

    GeminiLlmConnection.send_realtime = _patched_send_realtime
    logger.info("Applied send_realtime patch (audio=Blob) for %s", _GEMINI_MODEL)

# ── Always-on tool-response patch (model-agnostic) ─────────────────────────
# ADK's default send_content() sends LiveClientToolResponse without a
# turn_complete signal, which causes Gemini Live (in audio mode) to wait for
# user-VAD-end that never fires after a function call. The agent then stays
# silent forever. send_tool_response() is the proper Live API v1 path and
# triggers the model's follow-up turn correctly. This patch ONLY intercepts
# function-response sends; all other content flows are untouched.
_orig_send_content_for_tool = GeminiLlmConnection.send_content

import time as _patch_time

async def _patched_send_content_for_tool(self, content):
    parts = content.parts or []
    func_responses = [
        getattr(p, "function_response", None)
        for p in parts
        if getattr(p, "function_response", None)
    ]
    logger.info(
        "[VOICE patch] send_content intercept parts=%d func_responses=%d names=%s",
        len(parts),
        len(func_responses),
        [getattr(fr, "name", "?") for fr in func_responses],
    )
    if func_responses:
        t0 = _patch_time.time()
        try:
            logger.info("[VOICE patch] calling send_tool_response with %d response(s)", len(func_responses))
            await self._gemini_session.send_tool_response(
                function_responses=func_responses
            )
            logger.info(
                "[VOICE patch] send_tool_response OK (%.0fms) — awaiting Gemini follow-up turn",
                (_patch_time.time() - t0) * 1000,
            )
            return
        except Exception as exc:
            logger.warning(
                "[VOICE patch] send_tool_response FAILED after %.0fms (%s); falling back to original send_content",
                (_patch_time.time() - t0) * 1000,
                exc,
            )
    # Anything that isn't a function response, or any failure above, falls
    # through to the original ADK behaviour — no risk of regressing text/audio paths.
    logger.info("[VOICE patch] delegating to original send_content")
    await _orig_send_content_for_tool(self, content)

GeminiLlmConnection.send_content = _patched_send_content_for_tool
logger.info("Applied tool-response patch (model-agnostic) for %s", _GEMINI_MODEL)

# ── Strip session_resumption from Gemini.connect() (AI Studio 2.0 only) ────
# Needed for gemini-2.0-flash-live-* on AI Studio, which rejects transparent
# session resumption with `ValueError: Transparent session resumption is only
# supported for Vertex AI backend.`
# gemini-2.5-flash-native-audio-* and gemini-3.1-flash-live-preview DO support
# resumption on AI Studio (server continuously issues `Update session
# resumption handle` frames). Stripping it for those sends a partial/null
# session_resumption object that Gemini 3.1+ rejects with WS 1008.
import contextlib as _contextlib
from google.adk.models.google_llm import Gemini as _AdkGemini

_orig_adk_gemini_connect = _AdkGemini.connect


@_contextlib.asynccontextmanager
async def _patched_adk_gemini_connect(self, llm_request):
    cfg = llm_request.live_connect_config
    if _IS_LEGACY_2_0:
        # AI Studio 2.0 rejects transparent session resumption.
        if cfg and cfg.session_resumption:
            cfg.session_resumption = None
    elif _IS_3_1 and cfg is not None:
        # 3.1 Flash Live forbids send_client_content mid-session. The only way
        # to seed the agent's first turn is via LiveConnectConfig's initial
        # content field, which the SDK surfaces under a couple of aliases
        # depending on version. Try the known ones; silently skip if neither
        # exists (the system prompt already carries a greet-first instruction).
        seed = _genai_types.Content(
            role="user",
            parts=[_genai_types.Part(text="[Session started]")],
        )
        injected = False
        for attr in ("initial_client_content", "initial_content"):
            if hasattr(cfg, attr):
                try:
                    setattr(cfg, attr, [seed])
                    injected = True
                    logger.info("[VOICE 3.1 connect] seeded initial content via %s", attr)
                    break
                except Exception as exc:
                    logger.warning("[VOICE 3.1 connect] failed to set %s: %s", attr, exc)
        if not injected:
            logger.info(
                "[VOICE 3.1 connect] no initial_client_content field on LiveConnectConfig — relying on system-prompt greet-first"
            )
    async with _orig_adk_gemini_connect(self, llm_request) as conn:
        yield conn


_AdkGemini.connect = _patched_adk_gemini_connect
if _IS_LEGACY_2_0:
    logger.info("Applied Gemini.connect patch (strip session_resumption for AI Studio 2.0)")
elif _IS_3_1:
    logger.info("Applied Gemini.connect patch (inject initial_client_content for 3.1)")
else:
    logger.info("Applied Gemini.connect patch (no-op for %s)", _GEMINI_MODEL)

# NOTE: Sequential tool execution is enforced via the system prompt
# ("STRICTLY call only ONE tool per turn"). We do NOT patch the ADK's
# parallel execution — that can break the internal async flow and cause hangs.

# ── Imports that depend on generated stubs ───────────────────────────────────
import grpc
from grpc import aio
from generated import voice_pb2_grpc
from server.grpc_server import VoiceAgentServicer


async def serve() -> None:
    host = os.getenv("GRPC_HOST", "0.0.0.0")
    port = int(os.getenv("GRPC_PORT", "50051"))

    server = aio.server(options=[
        ("grpc.max_receive_message_length", 10 * 1024 * 1024),
        ("grpc.max_send_message_length", 10 * 1024 * 1024),
    ])
    voice_pb2_grpc.add_VoiceAgentServicer_to_server(VoiceAgentServicer(), server)
    server.add_insecure_port(f"{host}:{port}")

    await server.start()
    logger.info("ADK Voice gRPC server listening on %s:%d", host, port)

    try:
        await server.wait_for_termination()
    except (KeyboardInterrupt, asyncio.CancelledError):
        logger.info("Shutting down…")
        await server.stop(grace=5)


if __name__ == "__main__":
    asyncio.run(serve())
