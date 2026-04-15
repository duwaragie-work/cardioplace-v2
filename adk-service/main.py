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
# gemini-3.1-flash-live-preview requires special handling (realtime_input
# instead of LiveClientContent, audio field instead of media_chunks).
# gemini-2.0-flash-live-preview-04-09 works with standard ADK paths.
_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash-live-preview-04-09")

from google.adk.models.gemini_llm_connection import GeminiLlmConnection
from google.genai import types as _genai_types

if "3.1" in _GEMINI_MODEL:
    # Patch 1: send_realtime — use `audio` field instead of deprecated `media_chunks`.
    # 3.1-only because 2.0 uses the legacy `media_chunks` field which the patch would break.
    _original_send_realtime = GeminiLlmConnection.send_realtime

    async def _patched_send_realtime(self, input):  # noqa: A002
        if isinstance(input, _genai_types.Blob):
            await self._gemini_session.send_realtime_input(audio=input)
        else:
            await _original_send_realtime(self, input)

    GeminiLlmConnection.send_realtime = _patched_send_realtime
    logger.info("Applied send_realtime patch for %s", _GEMINI_MODEL)

# ── Always-on tool-response patch (model-agnostic) ─────────────────────────
# ADK's default send_content() sends LiveClientToolResponse without a
# turn_complete signal, which causes Gemini Live (in audio mode) to wait for
# user-VAD-end that never fires after a function call. The agent then stays
# silent forever. send_tool_response() is the proper Live API v1 path and
# triggers the model's follow-up turn correctly. This patch ONLY intercepts
# function-response sends; all other content flows are untouched.
_orig_send_content_for_tool = GeminiLlmConnection.send_content

async def _patched_send_content_for_tool(self, content):
    parts = content.parts or []
    func_responses = [
        getattr(p, "function_response", None)
        for p in parts
        if getattr(p, "function_response", None)
    ]
    if func_responses:
        try:
            await self._gemini_session.send_tool_response(
                function_responses=func_responses
            )
            logger.info(
                "[ToolResponsePatch] Sent %d function response(s) via send_tool_response",
                len(func_responses),
            )
            return
        except Exception as exc:
            logger.warning(
                "[ToolResponsePatch] send_tool_response failed (%s); falling back to original send_content",
                exc,
            )
    # Anything that isn't a function response, or any failure above, falls
    # through to the original ADK behaviour — no risk of regressing text/audio paths.
    await _orig_send_content_for_tool(self, content)

GeminiLlmConnection.send_content = _patched_send_content_for_tool
logger.info("Applied tool-response patch (model-agnostic) for %s", _GEMINI_MODEL)

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
