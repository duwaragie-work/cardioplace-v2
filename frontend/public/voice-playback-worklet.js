// Voice-playback AudioWorklet. Bug 48 — replaces the per-chunk
// AudioBufferSourceNode scheduling approach in useVoiceSession that produced
// audible gaps ("voice breaking / choppy / stuttering") whenever Gemini Live
// chunks arrived at varying rates or with sub-frame jitter.
//
// The Worklet runs on the audio render thread and pulls Float32 samples from
// an internal FIFO queue each 128-sample render quantum. Per-chunk
// scheduling, snap-forward, and the underrun click are gone — when the queue
// is empty the Worklet emits silence (zeros) until more samples arrive.
//
// Loaded by useVoiceSession's playback path via:
//   ctx.audioWorklet.addModule('/voice-playback-worklet.js')
// Next.js serves files from /public at the site root automatically.
//
// Wire protocol (port.onmessage):
//   • Float32Array  — PCM samples to append to the playback queue. The
//                     main thread decodes base64 → Int16 → Float32 ([-1, 1])
//                     and posts the Float32Array as a transferable so this
//                     side owns the buffer (zero-copy).
//   • { type: 'clear' }
//                   — drop everything in the queue immediately. Used on the
//                     'agent_interrupted' path so a real barge-in stops the
//                     agent's audio without waiting for the queue to drain.
//
// Wire protocol (port.postMessage from worklet → main):
//   • { type: 'drained' }
//                   — fired exactly once when the queue transitions from
//                     non-empty to empty. The main thread uses this to flip
//                     sessionState from 'agent_speaking' → 'listening' AFTER
//                     all queued audio has actually played, not when the
//                     last chunk was POSTED. Eliminates the old
//                     nextStartTimeRef-based scheduling drain.

class VoicePlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    // FIFO of Float32Array chunks. head is partially consumed via headOffset.
    this.queue = []
    this.headOffset = 0
    // Whether we've ever played a sample. Used to avoid spurious 'drained'
    // notifications before playback has started (queue starts empty by
    // definition).
    this.everPlayed = false

    this.port.onmessage = (event) => {
      const msg = event.data
      if (msg instanceof Float32Array) {
        this.queue.push(msg)
      } else if (msg && msg.type === 'clear') {
        this.queue = []
        this.headOffset = 0
      }
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0][0] // mono, first output, first channel
    const N = out.length
    let written = 0

    while (written < N && this.queue.length > 0) {
      const head = this.queue[0]
      const available = head.length - this.headOffset
      const remaining = N - written

      if (available <= remaining) {
        out.set(head.subarray(this.headOffset), written)
        written += available
        this.queue.shift()
        this.headOffset = 0
      } else {
        out.set(
          head.subarray(this.headOffset, this.headOffset + remaining),
          written,
        )
        this.headOffset += remaining
        written += remaining
      }
      this.everPlayed = true
    }

    if (written < N) {
      // Underrun — fill rest with silence. Critical: NOT optional. Returning
      // without filling causes downstream nodes to read uninitialised memory
      // (loud click or silence depending on browser).
      out.fill(0, written)

      // If we transitioned from "had samples" to "empty" this render, notify
      // the main thread exactly once so it can flip state cleanly.
      if (this.everPlayed) {
        this.everPlayed = false
        this.port.postMessage({ type: 'drained' })
      }
    }

    return true // keep processor alive
  }
}

registerProcessor('voice-playback', VoicePlaybackProcessor)
