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
# Live preview models (gemini-3.1-flash-live-preview, gemini-live-2.5-flash-preview,
# etc.) use the newer Live API (send_realtime_input, send_tool_response) — the
# standard ADK paths route tool responses through LiveClientToolResponse without
# turn_complete, which causes the model to go silent after function calls.
# Apply the patches for any Live preview model.
_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-live-preview")

from google.adk.models.gemini_llm_connection import GeminiLlmConnection
from google.genai import types as _genai_types

if "live" in _GEMINI_MODEL:
    # Patch 1: send_realtime — use `audio` field instead of deprecated `media_chunks`
    _original_send_realtime = GeminiLlmConnection.send_realtime

    async def _patched_send_realtime(self, input):  # noqa: A002
        if isinstance(input, _genai_types.Blob):
            await self._gemini_session.send_realtime_input(audio=input)
        else:
            await _original_send_realtime(self, input)

    GeminiLlmConnection.send_realtime = _patched_send_realtime
    logger.info("Applied send_realtime patch for %s", _GEMINI_MODEL)

    # Patch 2: send_content — use send_realtime_input(text=...) and send_tool_response
    _original_send_content = GeminiLlmConnection.send_content

    async def _patched_send_content(self, content):
        parts = content.parts or []
        has_function_response = any(
            getattr(p, "function_response", None) for p in parts
        )
        if has_function_response:
            func_responses = []
            for p in parts:
                fr = getattr(p, "function_response", None)
                if fr:
                    func_responses.append(fr)
            if func_responses:
                # Try send_tool_response first, then realtime text fallback,
                # then original send_content as last resort
                sent = False
                try:
                    await self._gemini_session.send_tool_response(
                        function_responses=func_responses
                    )
                    logger.info("Sent %d function response(s) via send_tool_response", len(func_responses))
                    sent = True
                except Exception as exc:
                    logger.error("send_tool_response failed: %s", exc)
                if not sent:
                    # Fallback: send as realtime text so model at least gets the result
                    try:
                        import json
                        for fr in func_responses:
                            text = json.dumps({"name": fr.name, "response": fr.response}, default=str)
                            await self._gemini_session.send_realtime_input(text=text)
                        logger.info("Sent %d function response(s) via realtime text fallback", len(func_responses))
                    except Exception as exc2:
                        logger.error("Realtime text fallback also failed: %s", exc2)
            else:
                await _original_send_content(self, content)
        else:
            text = "".join(
                p.text for p in parts if getattr(p, "text", None)
            )
            if text:
                await self._gemini_session.send_realtime_input(text=text)

    GeminiLlmConnection.send_content = _patched_send_content
    logger.info("Applied send_content patch for %s", _GEMINI_MODEL)
else:
    logger.info("Using standard ADK paths — no patches needed for %s", _GEMINI_MODEL)

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
