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

# ── Patches for gemini-3.1-flash-live-preview compatibility ─────────────────
# This model only accepts `realtime_input` messages; it rejects the
# `client_content` (LiveClientContent) format that ADK uses by default.
# It also requires the `audio` field (not deprecated `media_chunks`).
from google.adk.models.gemini_llm_connection import GeminiLlmConnection
from google.genai import types as _genai_types

# Patch 1: send_realtime — use `audio` field instead of deprecated `media_chunks`
_original_send_realtime = GeminiLlmConnection.send_realtime

async def _patched_send_realtime(self, input):  # noqa: A002
    if isinstance(input, _genai_types.Blob):
        await self._gemini_session.send_realtime_input(audio=input)
    else:
        await _original_send_realtime(self, input)

GeminiLlmConnection.send_realtime = _patched_send_realtime
logger.info("Applied send_realtime patch: audio field replaces media_chunks")

# Patch 2: send_content — use `send_realtime_input(text=...)` for user text
# content instead of LiveClientContent which gemini-3.1-flash-live-preview
# rejects with 1007 "invalid argument".
_original_send_content = GeminiLlmConnection.send_content

async def _patched_send_content(self, content):
    if content.parts and content.parts[0].function_response:
        # Function responses must still use the tool-response path
        await _original_send_content(self, content)
    else:
        # Concatenate all text parts and send as realtime text input
        text = "".join(
            p.text for p in (content.parts or []) if p.text
        )
        if text:
            await self._gemini_session.send_realtime_input(text=text)

GeminiLlmConnection.send_content = _patched_send_content
logger.info("Applied send_content patch: realtime_input text replaces LiveClientContent")

# ── Imports that depend on generated stubs ───────────────────────────────────
import grpc
from grpc import aio
from generated import voice_pb2_grpc
from server.grpc_server import VoiceAgentServicer


async def serve() -> None:
    host = os.getenv("GRPC_HOST", "0.0.0.0")
    port = int(os.getenv("GRPC_PORT", "50051"))

    server = aio.server()
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
