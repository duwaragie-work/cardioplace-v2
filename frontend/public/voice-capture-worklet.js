// Voice-capture AudioWorklet. Runs on the audio render thread — immune to
// main-thread jitter (React renders, Framer Motion frames, setInterval ticks,
// GC pauses). Converts Float32 mic samples → Int16 PCM and posts the buffer
// back to the main thread as a transferable (zero-copy handoff).
//
// Loaded by useVoiceSession.startMic() via:
//   ctx.audioWorklet.addModule('/voice-capture-worklet.js')
// Next.js serves files from /public at the site root automatically.
//
// `process()` fires every 128 samples (~8ms at 16kHz). 8ms chunks are below
// Gemini's recommended 20-40ms window AND quadruple the Socket.io emit rate.
// We accumulate FRAMES_PER_CHUNK frames (= 32ms = 512 samples) before posting
// so the wire rate stays at ~31 emits/sec while still preserving the audio-
// thread isolation that fixed the original chunking lag.

const FRAMES_PER_CHUNK = 4
const SAMPLES_PER_FRAME = 128
const SAMPLES_PER_CHUNK = FRAMES_PER_CHUNK * SAMPLES_PER_FRAME

class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Int16Array(SAMPLES_PER_CHUNK)
    this.writePos = 0
  }

  process(inputs) {
    const channel = inputs[0]?.[0]
    if (!channel || channel.length === 0) return true

    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]))
      this.buffer[this.writePos++] = s < 0 ? s * 0x8000 : s * 0x7fff

      if (this.writePos >= SAMPLES_PER_CHUNK) {
        // Transfer the buffer so the main thread owns it without a copy.
        this.port.postMessage(this.buffer, [this.buffer.buffer])
        this.buffer = new Int16Array(SAMPLES_PER_CHUNK)
        this.writePos = 0
      }
    }
    return true
  }
}

registerProcessor('voice-capture', VoiceCaptureProcessor)
