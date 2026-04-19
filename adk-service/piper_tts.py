"""
Piper TTS wrapper.

Responsibilities:
- Load the ONNX voice model once at startup (warm-up avoids cold-start on turn 1).
- Synthesize text to PCM chunks.
- Resample from Piper's native rate (22050 Hz for en_US-lessac-medium) to the
  frontend's expected 24000 Hz so the existing audio-playback code works
  unchanged.
- Pre-synthesize a small bank of "filler" acknowledgments that VoiceSession can
  play immediately on user-turn-end to mask real model latency.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

# Frontend's playback AudioContext runs at 24 kHz. Piper's en_US-lessac-medium
# outputs 22050 Hz. We resample in-process rather than changing the frontend.
TARGET_SAMPLE_RATE = 24000

# Default filler phrases. Short, neutral, play while the model thinks.
# Kept generic on purpose — "got it" after a yes/no or a statement both work.
DEFAULT_FILLERS = [
    "Got it.",
    "One moment.",
    "Let me check.",
    "Okay.",
]


@dataclass
class SynthResult:
    """Output of a single synthesis call — raw int16 PCM at 24 kHz mono."""
    pcm_24k: bytes
    sample_rate: int = TARGET_SAMPLE_RATE


class PiperTTS:
    """
    Stateful wrapper — one instance per adk-service process.
    Loads the model once and reuses it for every synthesis call.
    """

    def __init__(self, voice: str = "en_US-lessac-medium", voices_dir: str | None = None):
        self.voice = voice
        self.voices_dir = Path(voices_dir or os.path.join(os.path.dirname(__file__), "voices"))
        self.voices_dir.mkdir(exist_ok=True)
        self._piper = None  # Lazy-loaded piper.PiperVoice instance
        self._source_rate = 22050  # Overwritten at load time

    def load(self) -> None:
        """Load the Piper model (blocking; do this at service startup)."""
        t0 = time.time()
        # Import lazily so the rest of the service can start up even if piper
        # isn't installed yet (useful during incremental rollout).
        from piper import PiperVoice  # type: ignore

        # Piper expects <voice>.onnx and <voice>.onnx.json side by side.
        onnx_path = self.voices_dir / f"{self.voice}.onnx"
        config_path = self.voices_dir / f"{self.voice}.onnx.json"
        if not onnx_path.exists() or not config_path.exists():
            raise FileNotFoundError(
                f"Piper voice files missing under {self.voices_dir}. "
                f"Download {self.voice}.onnx and {self.voice}.onnx.json from "
                f"https://github.com/rhasspy/piper/blob/master/VOICES.md and "
                f"place them in that directory."
            )

        self._piper = PiperVoice.load(str(onnx_path), config_path=str(config_path))
        self._source_rate = int(self._piper.config.sample_rate)
        logger.info(
            "[PIPER] loaded voice=%s source_rate=%d target_rate=%d (%.0fms)",
            self.voice,
            self._source_rate,
            TARGET_SAMPLE_RATE,
            (time.time() - t0) * 1000,
        )

    def warm(self) -> None:
        """Run one throwaway synthesis so the ONNX runtime JITs its graphs."""
        if self._piper is None:
            self.load()
        t0 = time.time()
        _ = self.synth("Hi.")
        logger.info("[PIPER] warm-up synth done (%.0fms)", (time.time() - t0) * 1000)

    def synth(self, text: str) -> SynthResult:
        """
        Synthesize `text` and return 16-bit PCM at 24 kHz mono.

        Blocking. Call from the async event loop via asyncio.to_thread so you
        don't stall the gRPC pump while Piper runs.

        Uses the Piper 1.3+ iterator API: PiperVoice.synthesize() yields
        AudioChunk objects whose .audio_int16_bytes is raw int16 PCM at the
        voice's native sample rate. We concatenate, then resample to 24 kHz.
        """
        if self._piper is None:
            self.load()
        assert self._piper is not None

        pcm_source_parts: list[bytes] = []
        for chunk in self._piper.synthesize(text):
            pcm_source_parts.append(chunk.audio_int16_bytes)
        pcm_source = np.frombuffer(b"".join(pcm_source_parts), dtype=np.int16)

        # Resample to 24 kHz if Piper's native rate differs.
        if self._source_rate != TARGET_SAMPLE_RATE:
            pcm_24k = _resample_int16(pcm_source, self._source_rate, TARGET_SAMPLE_RATE)
        else:
            pcm_24k = pcm_source

        return SynthResult(pcm_24k=pcm_24k.tobytes(), sample_rate=TARGET_SAMPLE_RATE)

    def presynth_fillers(self, phrases: list[str] | None = None) -> list[bytes]:
        """
        Pre-synthesise filler acknowledgments once. Returns a list of 24 kHz
        PCM blobs that can be sent straight over the wire as soon as the user's
        turn ends, masking real model latency.
        """
        if self._piper is None:
            self.load()
        phrases = phrases or DEFAULT_FILLERS
        out: list[bytes] = []
        t0 = time.time()
        for p in phrases:
            out.append(self.synth(p).pcm_24k)
        logger.info(
            "[PIPER] pre-synthesised %d fillers (%.0fms total)",
            len(out),
            (time.time() - t0) * 1000,
        )
        return out


def _resample_int16(pcm: np.ndarray, src_rate: int, tgt_rate: int) -> np.ndarray:
    """
    Resample 16-bit PCM using a simple polyphase filter.

    Uses numpy only (no scipy) to keep the dep surface small. Quality is fine
    for speech at 22050→24000 Hz. Output is clipped to int16 range.
    """
    if src_rate == tgt_rate:
        return pcm
    # Compute the simplest up/down ratio.
    from math import gcd

    g = gcd(src_rate, tgt_rate)
    up = tgt_rate // g
    down = src_rate // g

    # Upsample by inserting zeros, low-pass (here just linear interp via
    # np.interp which is adequate for speech), then downsample.
    # For 22050→24000 this is up=160, down=147 — a gentle ratio where np.interp
    # produces audibly clean output.
    n_in = len(pcm)
    # Target sample count after exact resample.
    n_out = int(round(n_in * up / down))
    # Input time axis (indices in source samples) for each output sample.
    t_out = np.arange(n_out) * (down / up)
    t_in = np.arange(n_in)
    resampled = np.interp(t_out, t_in, pcm.astype(np.float32))
    return np.clip(resampled, -32768, 32767).astype(np.int16)


# Singleton for the module — one voice loaded per process.
_instance: PiperTTS | None = None


def get_tts() -> PiperTTS:
    global _instance
    if _instance is None:
        voice = os.getenv("PIPER_VOICE", "en_US-lessac-medium")
        _instance = PiperTTS(voice=voice)
    return _instance
