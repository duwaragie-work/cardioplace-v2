"""
Cardioplace voice service — Groq + Cerebras + Piper hybrid.

Entry point:
    python main.py

Replaces the previous Google ADK / Gemini Live setup. Targets ~650-950 ms
user→agent first-audio latency using:
    ASR  → Groq Whisper-large-v3-turbo (hosted, free tier)
    LLM  → Cerebras Llama 3.3 70B (hosted, free tier; Groq fallback on 429)
    TTS  → Piper en_US-lessac-medium (local, CPU, open-source)
"""

import asyncio
import logging
import os
import pathlib
import subprocess
import sys

from dotenv import load_dotenv

load_dotenv()

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

# ── OpenTelemetry / LangSmith tracing ─────────────────────────────────────────
if os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"):
    try:
        # Keep the legacy ADK telemetry helper if available; otherwise fall
        # back to standard OTEL exporters. Harmless either way — spans from
        # VoiceSession are emitted via the `healplace.voice` tracer in grpc_server.
        try:
            from google.adk.telemetry.setup import maybe_set_otel_providers  # type: ignore
            maybe_set_otel_providers()
        except Exception:
            pass
        logger.info(
            "OpenTelemetry tracing enabled → %s",
            os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"),
        )
    except Exception as e:
        logger.warning("Failed to set up OpenTelemetry tracing: %s", e)
else:
    logger.info("OpenTelemetry tracing disabled")

# ── Generate proto stubs if missing ───────────────────────────────────────────
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

# Make the generated package importable via its flat name (the generated
# grpc stub uses `import voice_pb2` rather than `from generated import …`).
sys.path.insert(0, str(_GENERATED.resolve()))

# ── Imports that depend on generated stubs ────────────────────────────────────
from grpc import aio  # noqa: E402
from generated import voice_pb2_grpc  # noqa: E402
from server.grpc_server import VoiceAgentServicer  # noqa: E402
from piper_tts import get_tts  # noqa: E402


async def serve() -> None:
    host = os.getenv("GRPC_HOST", "0.0.0.0")
    port = int(os.getenv("GRPC_PORT", "50051"))

    # ── Warm Piper once at startup ───────────────────────────────────────
    # This eats the ~400 ms ONNX cold-start so the first turn doesn't feel
    # sluggish. Also pre-synthesises filler acknowledgments.
    tts = get_tts()
    tts.load()
    tts.warm()

    logger.info(
        "[VOICE boot] asr=groq/%s llm=cerebras/%s tts=piper/%s",
        os.getenv("GROQ_ASR_MODEL", "whisper-large-v3-turbo"),
        os.getenv("CEREBRAS_LLM_MODEL", "llama-3.3-70b"),
        os.getenv("PIPER_VOICE", "en_US-lessac-medium"),
    )

    if os.getenv("ENABLE_FILLER_ACK", "true").lower() == "true":
        fillers = tts.presynth_fillers()
    else:
        fillers = []
        logger.info("[VOICE boot] ENABLE_FILLER_ACK=false — skipping filler pre-synth")

    # ── Launch gRPC server ───────────────────────────────────────────────
    server = aio.server(
        options=[
            ("grpc.max_receive_message_length", 10 * 1024 * 1024),
            ("grpc.max_send_message_length", 10 * 1024 * 1024),
        ]
    )
    servicer = VoiceAgentServicer(tts_synth=tts.synth, piper_fillers=fillers)
    voice_pb2_grpc.add_VoiceAgentServicer_to_server(servicer, server)
    server.add_insecure_port(f"{host}:{port}")

    await server.start()
    logger.info("Voice gRPC server listening on %s:%d", host, port)

    try:
        await server.wait_for_termination()
    except (KeyboardInterrupt, asyncio.CancelledError):
        logger.info("Shutting down…")
        await server.stop(grace=5)


if __name__ == "__main__":
    asyncio.run(serve())
