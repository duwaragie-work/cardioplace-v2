'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

// ── Debug logging ─────────────────────────────────────────────────────────────
// Gate on NEXT_PUBLIC_VOICE_DEBUG=1 to keep prod console clean.
const VOICE_DEBUG =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_VOICE_DEBUG === '1';
function debug(tag: string, ...args: unknown[]) {
  if (VOICE_DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`[VOICE ${tag}]`, ...args);
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type SessionState =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'listening'
  | 'agent_speaking'
  | 'processing'
  | 'checkin_confirm'
  | 'error';

/**
 * Lifecycle of the background pre-warm socket, independent of sessionState.
 *
 * - 'idle'    — never attempted (or fully cleaned up)
 * - 'warming' — socket open, waiting for session_ready (or reconnecting)
 * - 'ready'   — session_ready received; first mic click has no setup delay
 * - 'failed'  — terminal (reconnect_failed fired); socketRef nulled so the
 *               next start() builds a fresh socket rather than waiting on a
 *               dead one. One automatic retry is scheduled 5s after entering
 *               this state IF the failure happened during a passive prewarm.
 */
export type PrewarmStatus = 'idle' | 'warming' | 'ready' | 'failed';

// Max auto-retries after terminal failure. Keep low — if prewarm fails twice
// it's likely the backend is down; user-click will trigger another attempt
// on demand.
const PREWARM_AUTO_RETRY_LIMIT = 1;
const PREWARM_AUTO_RETRY_DELAY_MS = 5000;

export interface TranscriptLine {
  id: number;
  speaker: 'user' | 'agent';
  text: string;
  isFinal: boolean;
}

export interface CheckinSummary {
  systolicBP?: number;
  diastolicBP?: number;
  weight?: number;
  medicationTaken?: boolean;
  symptoms: string[];
  saved: boolean;
}

export interface UpdateSummary {
  entryId: string;
  entryDate?: string;
  systolicBP?: number;
  diastolicBP?: number;
  weight?: number;
  medicationTaken?: boolean;
  symptoms: string[];
  updated: boolean;
}

export interface DeleteSummary {
  entryIds: string[];
  deletedCount: number;
  failedCount: number;
  success: boolean;
  message: string;
}

export interface StartOptions {
  token: string;
  sessionId?: string;
}

// ── Audio helpers ─────────────────────────────────────────────────────────────

function floatTo16BitPCM(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToFloat32(base64: string, sampleRate: number): AudioBuffer | null {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }
    const ctx = new AudioContext({ sampleRate });
    const buffer = ctx.createBuffer(1, float32.length, sampleRate);
    buffer.getChannelData(0).set(float32);
    ctx.close();
    return buffer;
  } catch {
    return null;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useVoiceSession(onSessionCreated?: (sessionId: string) => void) {
  const [sessionState, setSessionStateRaw] = useState<SessionState>('idle');
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [pendingCheckin, setPendingCheckin] = useState<CheckinSummary | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<UpdateSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DeleteSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [actionTypeState, setActionTypeRaw] = useState<string | null>(null);

  // Logged wrappers so every state/actionType transition is visible when debug is on.
  const setSessionState = useCallback(
    (updater: SessionState | ((prev: SessionState) => SessionState), reason?: string) => {
      setSessionStateRaw((prev) => {
        const next = typeof updater === 'function' ? (updater as (p: SessionState) => SessionState)(prev) : updater;
        if (next !== prev) debug('state', `${prev} → ${next}${reason ? ` (${reason})` : ''}`);
        return next;
      });
    },
    [],
  );
  const setActionType = useCallback(
    (updater: string | null | ((prev: string | null) => string | null), reason?: string) => {
      setActionTypeRaw((prev) => {
        const next = typeof updater === 'function' ? (updater as (p: string | null) => string | null)(prev) : updater;
        if (next !== prev) debug('actionType', `${prev} → ${next}${reason ? ` (${reason})` : ''}`);
        return next;
      });
    },
    [],
  );
  const actionType = actionTypeState;

  const socketRef = useRef<Socket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processorRef = useRef<any>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  // Scheduled playback — each arriving audio chunk is scheduled to start at
  // nextStartTimeRef on the playback AudioContext, avoiding the onended gap
  // that caused choppy output. When no chunks arrive for ~200ms after the
  // last scheduled end, drainTimerRef fires and reverts state to 'listening'.
  const nextStartTimeRef = useRef<number>(0);
  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latency: stamp when user's final transcript arrives, measure again on the
  // first agent audio chunk of the reply. Cleared after one measurement so we
  // don't keep rewriting the stamp as more audio streams in.
  const lastUserFinalTimeRef = useRef<number | null>(null);
  // Client-side VAD — track whether we're currently in a "speaking" span, and
  // when silence began, so we can emit audio_stream_end after a pause. Gemini
  // Live otherwise waits ~300-500ms of trailing silence to finalise the turn.
  const speakingRef = useRef(false);
  const silenceStartRef = useRef<number | null>(null);
  // Session pre-warm: prewarmedRef becomes true once 'session_ready' arrives.
  // startMicPendingRef says "when ready, start the mic" — set by start() when
  // the user clicks before prewarm completed, cleared once startMic runs.
  const prewarmedRef = useRef(false);
  const startMicPendingRef = useRef(false);
  const transcriptIdRef = useRef(0);
  const onSessionCreatedRef = useRef(onSessionCreated);

  // Prewarm lifecycle tracking — separate from sessionState so the UI can
  // reflect "voice unavailable" without flipping the main session state.
  const [prewarmStatus, setPrewarmStatus] = useState<PrewarmStatus>('idle');
  // Original intent of the in-flight _open call. Consulted by reconnect_failed
  // to decide whether to auto-retry ('prewarm' → yes; 'start' → no, user will
  // click again and see the error directly).
  const prewarmIntentRef = useRef<'prewarm' | 'start' | null>(null);
  // Last-known credentials for auto-retry after terminal failure.
  const lastPrewarmOptsRef = useRef<StartOptions | null>(null);
  // Number of auto-retries attempted so far for the current failure.
  const prewarmRetryCountRef = useRef(0);
  // Timer for scheduled auto-retry. Cleared on cleanup/end/successful retry.
  const prewarmRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      void cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cleanup = useCallback(async () => {
    stopMic();
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    if (drainTimerRef.current) {
      clearTimeout(drainTimerRef.current);
      drainTimerRef.current = null;
    }
    if (playbackContextRef.current) {
      await playbackContextRef.current.close().catch(() => {});
      playbackContextRef.current = null;
    }
    nextStartTimeRef.current = 0;
    prewarmedRef.current = false;
    startMicPendingRef.current = false;
    // Reset prewarm lifecycle on full cleanup so the next mount starts clean.
    if (prewarmRetryTimerRef.current) {
      clearTimeout(prewarmRetryTimerRef.current);
      prewarmRetryTimerRef.current = null;
    }
    prewarmIntentRef.current = null;
    prewarmRetryCountRef.current = 0;
    setPrewarmStatus('idle');
  }, []);

  const stopMic = useCallback(() => {
    debug('mic', 'stopMic');
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    speakingRef.current = false;
    silenceStartRef.current = null;
  }, []);

  const startMic = useCallback(async () => {
    debug('mic', 'startMic');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    micStreamRef.current = stream;

    const ctx = new AudioContext({ sampleRate: 16000 });
    audioContextRef.current = ctx;

    const source = ctx.createMediaStreamSource(stream);
    sourceRef.current = source;

    // ScriptProcessorNode — captures raw PCM and sends to backend.
    // createScriptProcessor requires a power-of-2 bufferSize in {256, 512,
    // 1024, 2048, 4096, 8192, 16384}. 512 @ 16kHz = 32ms chunks, which sits
    // in Google Live API's recommended 20–40ms window. Down from 2048 (128ms)
    // for ~96ms lower server-side VAD buffering per turn.
    const bufferSize = 512;
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const processor = ctx.createScriptProcessor(bufferSize, 1, 1);
    processorRef.current = processor;

    // Client-side VAD thresholds.
    //  - RMS_THRESHOLD 0.02: distinguishes real speech from low-level noise
    //    (breathing, mic self-noise) after echoCancellation/noiseSuppression.
    //  - END_OF_UTTERANCE_MS 500: shaves ~300 ms off Gemini's own VAD tail.
    //    Short decisive utterances ("save it", "yes", "no") shouldn't wait
    //    800 ms to be finalised. Mid-sentence pauses up to ~400 ms are still
    //    safe because the cooldown + the user resuming speech both protect
    //    against premature turn-ends.
    //  - COOLDOWN_MS 2000: after an emit, suppress further emits for 2 s so a
    //    user who pauses, resumes, pauses again doesn't spam the signal.
    const RMS_THRESHOLD = 0.02;
    const END_OF_UTTERANCE_MS = 300;
    const COOLDOWN_MS = 2000;
    let lastEmitAt = 0;

    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!socketRef.current?.connected) return;
      const float32 = e.inputBuffer.getChannelData(0);

      // RMS of this frame for VAD. Cheap: sum of squares / N, then sqrt.
      let sumSq = 0;
      for (let i = 0; i < float32.length; i++) sumSq += float32[i] * float32[i];
      const rms = Math.sqrt(sumSq / float32.length);
      const now = performance.now();

      if (rms >= RMS_THRESHOLD) {
        // Speech frame.
        if (!speakingRef.current) {
          speakingRef.current = true;
          debug('vad', 'speech start');
        }
        silenceStartRef.current = null;
      } else {
        // Silence frame.
        if (speakingRef.current) {
          if (silenceStartRef.current === null) {
            silenceStartRef.current = now;
          } else if (now - silenceStartRef.current >= END_OF_UTTERANCE_MS) {
            speakingRef.current = false;
            silenceStartRef.current = null;
            if (now - lastEmitAt >= COOLDOWN_MS) {
              lastEmitAt = now;
              debug('vad', `speech end — emit audio_stream_end after ${END_OF_UTTERANCE_MS}ms silence`);
              socketRef.current.emit('audio_stream_end');
            } else {
              debug('vad', 'speech end — suppressed (cooldown)');
            }
          }
        }
      }

      // Always forward the audio frame. Even during silence, trailing context
      // helps Gemini's ASR; if the user resumes mid-pause, no frames are dropped.
      const int16 = floatTo16BitPCM(float32);
      const base64 = arrayBufferToBase64(int16.buffer as ArrayBuffer);
      socketRef.current.emit('audio_chunk', base64);
    };

    source.connect(processor);
    processor.connect(ctx.destination);
    setSessionState('listening', 'startMic success');
  }, [setSessionState]);

  // Scheduled playback — eliminates the onended gap that causes choppy audio.
  // Each arriving chunk is decoded and scheduled to start at nextStartTimeRef.
  // If the first chunk in a turn, seed the scheduler PREROLL_MS ahead of
  // currentTime so one late-arriving second chunk can't underrun. After the
  // last scheduled chunk ends, DRAIN_MS of silence triggers a revert to
  // 'listening' state.
  const playAudio = useCallback((audioBase64: string) => {
    const OUTPUT_SAMPLE_RATE = 24000;
    // Playback pre-roll. Seeds the scheduler this many ms ahead of
    // currentTime on the first chunk of a turn so one late-arriving second
    // chunk can't underrun. Lower = first syllable arrives sooner; higher =
    // more tolerant of network jitter. 60 ms is tight but tolerable on a
    // wired/good-WiFi connection for most listeners.
    const PREROLL_MS = 60;
    const DRAIN_MS = 200;

    if (!playbackContextRef.current) {
      playbackContextRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    }
    const ctx = playbackContextRef.current;

    const buffer = base64ToFloat32(audioBase64, OUTPUT_SAMPLE_RATE);
    if (!buffer) {
      debug('audio', 'playAudio: decode failed');
      return;
    }

    // Seed the scheduler if this is the first chunk of a new agent turn.
    // nextStartTime is "behind" the clock when there's been a gap.
    const now = ctx.currentTime;
    if (nextStartTimeRef.current < now + 0.01) {
      nextStartTimeRef.current = now + PREROLL_MS / 1000;
      debug('audio', `first chunk of turn — seeded scheduler at +${PREROLL_MS}ms`);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += buffer.duration;

    setSessionState('agent_speaking', 'audio_response');

    // Reset the drain timer — if no more chunks arrive for DRAIN_MS after the
    // last scheduled chunk ends, revert to listening.
    if (drainTimerRef.current) clearTimeout(drainTimerRef.current);
    const msUntilEnd = Math.max(0, (nextStartTimeRef.current - now) * 1000) + DRAIN_MS;
    drainTimerRef.current = setTimeout(() => {
      debug('audio', 'drain timer fired — reverting to listening');
      setSessionState((prev) => (prev === 'agent_speaking' ? 'listening' : prev), 'audio drained');
      drainTimerRef.current = null;
    }, msUntilEnd);
  }, [setSessionState]);

  const appendTranscript = useCallback(
    (text: string, speaker: 'user' | 'agent', isFinal: boolean) => {
      if (!text.trim()) return;
      setTranscript((prev) => {
        // Update last line if same speaker and not yet final
        const last = prev[prev.length - 1];
        if (last && last.speaker === speaker && !last.isFinal) {
          return [
            ...prev.slice(0, -1),
            { ...last, text: last.text + text, isFinal },
          ];
        }
        return [
          ...prev,
          { id: ++transcriptIdRef.current, speaker, text, isFinal },
        ];
      });
    },
    [],
  );

  // ── Public API ──────────────────────────────────────────────────────────────

  // Stable indirection to _open so the inner reconnect_failed handler can
  // schedule an auto-retry without forming a circular useCallback dep. The
  // ref is rebound after every _open instance (see useEffect below).
  const _openRef = useRef<
    ((opts: StartOptions, requestMic: boolean) => Promise<void>) | null
  >(null);

  // Shared entry used by both start() (user clicked mic) and prewarm() (page
  // mounted — open the socket in the background so the first click has no
  // session-setup latency). `requestMic` controls whether we also start the
  // mic as soon as session_ready arrives.
  const _open = useCallback(
    async ({ token, sessionId }: StartOptions, requestMic: boolean) => {
      debug(requestMic ? 'start' : 'prewarm', `sessionId=${sessionId ?? 'new'} socketOpen=${!!socketRef.current} prewarmed=${prewarmedRef.current}`);

      // Remember creds for potential auto-retry. Prewarm is always safe to
      // replay; start() saves them too since a subsequent click may recover
      // from a prior failure.
      lastPrewarmOptsRef.current = { token, sessionId };

      // If the previous attempt failed terminally, socketRef was already
      // nulled by the reconnect_failed handler — no cleanup needed. But if
      // this is a user click while an auto-retry is scheduled, cancel the
      // timer so we don't fire a stale retry on top of the user's attempt.
      if (prewarmRetryTimerRef.current) {
        clearTimeout(prewarmRetryTimerRef.current);
        prewarmRetryTimerRef.current = null;
      }

      // Fast path: socket already open and session ready — user just clicked.
      if (socketRef.current && prewarmedRef.current && requestMic) {
        setSessionState('connecting', 'start() (warm)');
        setTranscript([]);
        setPendingCheckin(null);
        setPendingUpdate(null);
        setPendingDelete(null);
        setErrorMessage('');
        startMicPendingRef.current = false;
        try {
          await startMic();
        } catch (err) {
          debug('start', 'warm startMic failed', err);
          setSessionState('error', 'mic denied');
          setErrorMessage('Microphone access denied. Please allow microphone access and try again.');
        }
        return;
      }

      // Socket exists but session not ready yet (prewarm still in flight).
      // If the user clicked, flag the pending intent; session_ready will run
      // startMic when it fires. If it's another prewarm call, just no-op.
      if (socketRef.current) {
        if (requestMic) {
          // Promote intent so terminal failure knows a user is actually waiting.
          prewarmIntentRef.current = 'start';
          startMicPendingRef.current = true;
          setSessionState('connecting', 'start() awaiting ready');
          setTranscript([]);
          setPendingCheckin(null);
          setPendingUpdate(null);
          setPendingDelete(null);
          setErrorMessage('');
        }
        return;
      }

      // Fresh setup: build the socket from scratch. Record intent so that
      // reconnect_failed later knows whether to schedule an auto-retry.
      prewarmIntentRef.current = requestMic ? 'start' : 'prewarm';
      setPrewarmStatus('warming');
      if (requestMic) {
        setSessionState('connecting', 'start()');
        setTranscript([]);
        setPendingCheckin(null);
        setPendingUpdate(null);
        setPendingDelete(null);
        setErrorMessage('');
        startMicPendingRef.current = true;
      } else {
        startMicPendingRef.current = false;
      }
      prewarmedRef.current = false;

      const wsUrl =
        process.env.NEXT_PUBLIC_VOICE_WS_URL ?? 'http://localhost:8080';

      const socket = io(`${wsUrl}/voice`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });
      socketRef.current = socket;

      socket.on('session_ready', async (data?: { sessionId?: string }) => {
        debug('socket', `session_ready sessionId=${data?.sessionId ?? 'none'} micPending=${startMicPendingRef.current}`);
        prewarmedRef.current = true;
        // Prewarm succeeded — reset retry counter and surface ready state.
        prewarmRetryCountRef.current = 0;
        prewarmIntentRef.current = null;
        setPrewarmStatus('ready');
        if (prewarmRetryTimerRef.current) {
          clearTimeout(prewarmRetryTimerRef.current);
          prewarmRetryTimerRef.current = null;
        }
        // Notify consumer of resolved sessionId (may be a newly created one)
        if (data?.sessionId) {
          onSessionCreatedRef.current?.(data.sessionId);
        }
        // Only start the mic if the user actually clicked. Pre-warm paths
        // (page-load background setup) leave startMicPendingRef false and
        // keep the session idle until the user engages.
        if (!startMicPendingRef.current) return;
        startMicPendingRef.current = false;
        try {
          await startMic();
        } catch (err) {
          debug('socket', 'session_ready → startMic failed', err);
          setSessionState('error', 'mic denied');
          setErrorMessage('Microphone access denied. Please allow microphone access and try again.');
          socket.disconnect();
        }
      });

      socket.on('audio_response', (data: { audio: string }) => {
        if (VOICE_DEBUG) debug('socket', `audio_response bytes=${data.audio?.length ?? 0}`);
        // Latency: first audio chunk after a user final closes the loop.
        if (lastUserFinalTimeRef.current !== null) {
          const ms = Math.round(performance.now() - lastUserFinalTimeRef.current);
          debug('latency', `user→agent_first_audio=${ms}ms`);
          lastUserFinalTimeRef.current = null;
        }
        playAudio(data.audio);
        // First agent audio after a tool call implies the tool finished and the
        // agent is now speaking the result — clear any in-flight action overlay.
        // Safety net for tools (delete, fetch) that don't emit a dedicated
        // completion event.
        setActionType((current) => (current ? null : current), 'audio_response safety net');
      });

      socket.on('transcript', (data: { text: string; isFinal: boolean; speaker: 'user' | 'agent' }) => {
        if (data.isFinal && data.text.trim()) {
          debug('socket', `transcript [${data.speaker}] "${data.text.slice(0, 60)}"`);
        }
        // Stamp the moment the user's speaking turn ended so we can measure
        // the gap until the first agent audio chunk arrives.
        if (data.speaker === 'user' && data.isFinal && data.text.trim()) {
          lastUserFinalTimeRef.current = performance.now();
        }
        appendTranscript(data.text, data.speaker, data.isFinal);
        // Detect end-call voice commands from user
        if (data.speaker === 'user' && data.isFinal) {
          const lower = data.text.toLowerCase();
          const endPhrases = ['end the call', 'end call', 'hang up', 'stop the call', 'cut the call', 'bye', 'goodbye', 'end session', 'stop session'];
          if (endPhrases.some((p) => lower.includes(p))) {
            debug('socket', 'end phrase detected — scheduling cleanup in 1500ms');
            setTimeout(() => {
              socketRef.current?.emit('end_session');
              void cleanup();
              setSessionState('idle', 'end-phrase cleanup');
              setPendingCheckin(null);
              setPendingUpdate(null);
              setPendingDelete(null);
              setActionType(null, 'end-phrase cleanup');
            }, 1500); // Small delay so AI can say goodbye
          }
        }
      });

      socket.on('action', (data: { type: string; detail: string }) => {
        debug('socket', `action type=${data.type} detail="${data.detail?.slice(0, 80)}"`);
        setActionType(data.type, `action ${data.type}`);
        if (['submitting_checkin', 'updating_checkin', 'deleting_checkin', 'fetching_readings'].includes(data.type)) {
          setSessionState('processing', `action ${data.type}`);
        }
      });

      socket.on('action_complete', (data: { type: string; success: boolean; detail: string }) => {
        debug('socket', `action_complete type=${data.type} success=${data.success}`);
        setActionType((current) => (current === data.type ? null : current), `action_complete ${data.type}`);
        setSessionState((prev) => (prev === 'processing' ? 'listening' : prev), 'action_complete');
      });

      socket.on('checkin_saved', (summary: CheckinSummary) => {
        debug('socket', `checkin_saved BP=${summary.systolicBP}/${summary.diastolicBP} saved=${summary.saved}`);
        setPendingCheckin(summary);
        setActionType(null, 'checkin_saved');
        setSessionState('checkin_confirm', 'checkin_saved');
        // Do NOT stop mic here — NO_INTERRUPTION on the backend prevents the
        // mic from cancelling the agent's confirmation. Keeping it open lets
        // the conversation continue after the card auto-dismisses.
      });

      socket.on('checkin_updated', (summary: UpdateSummary) => {
        debug('socket', `checkin_updated entryId=${summary.entryId} updated=${summary.updated}`);
        setPendingUpdate(summary);
        setActionType(null, 'checkin_updated');
        setSessionState((prev) => (prev === 'processing' ? 'listening' : prev), 'checkin_updated');
      });

      socket.on('checkin_deleted', (summary: DeleteSummary) => {
        debug('socket', `checkin_deleted count=${summary.deletedCount}/${summary.failedCount} success=${summary.success}`);
        setPendingDelete(summary);
        setActionType(null, 'checkin_deleted');
        setSessionState((prev) => (prev === 'processing' ? 'listening' : prev), 'checkin_deleted');
      });

      socket.on('session_error', (data: { message: string }) => {
        debug('socket', `session_error "${data.message}"`);
        setErrorMessage(data.message);
        setSessionState('error', 'session_error');
        stopMic();
      });

      socket.on('session_closed', () => {
        debug('socket', 'session_closed');
        stopMic();
        setSessionState('idle', 'session_closed');
      });

      socket.on('connect_error', (err) => {
        debug('socket', `connect_error ${err.message}`);
        setErrorMessage(`Connection failed: ${err.message}`);
        // Only surface 'error' sessionState if a user was actively waiting
        // (clicked mic). Pure background prewarm failures should stay quiet
        // in the main UI — prewarmStatus carries the signal instead.
        if (prewarmIntentRef.current === 'start' || startMicPendingRef.current) {
          setSessionState('error', 'connect_error');
        }
        // Per-attempt error — Socket.io may still retry. Don't null socketRef
        // yet; reconnect_failed below handles terminal failure.
      });

      // Terminal: Socket.io exhausted reconnectionAttempts. Null the socket
      // ref so the next start()/prewarm() builds a fresh one. Schedule ONE
      // auto-retry if this was a passive prewarm (user isn't staring at a
      // spinner waiting on us).
      socket.on('reconnect_failed', () => {
        debug('socket', 'reconnect_failed — terminal');
        const wasPrewarm = prewarmIntentRef.current === 'prewarm' && !startMicPendingRef.current;
        // Tear down the dead socket.
        try {
          socket.disconnect();
        } catch {
          // best-effort
        }
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        prewarmedRef.current = false;
        setPrewarmStatus('failed');

        if (startMicPendingRef.current) {
          // User had clicked the mic and was waiting — they need to see the
          // error, not a silent spinner.
          startMicPendingRef.current = false;
          setSessionState('error', 'reconnect_failed while waiting');
          setErrorMessage(
            'Voice is temporarily unavailable. Please try again in a moment.',
          );
        }

        if (
          wasPrewarm &&
          prewarmRetryCountRef.current < PREWARM_AUTO_RETRY_LIMIT &&
          lastPrewarmOptsRef.current
        ) {
          prewarmRetryCountRef.current += 1;
          const opts = lastPrewarmOptsRef.current;
          debug('socket', `scheduling prewarm retry ${prewarmRetryCountRef.current}/${PREWARM_AUTO_RETRY_LIMIT} in ${PREWARM_AUTO_RETRY_DELAY_MS}ms`);
          prewarmRetryTimerRef.current = setTimeout(() => {
            prewarmRetryTimerRef.current = null;
            // Guard: if the component unmounted or a user-initiated start()
            // happened in the meantime, skip the retry.
            if (socketRef.current || !lastPrewarmOptsRef.current) return;
            void _openRef.current?.(opts, false);
          }, PREWARM_AUTO_RETRY_DELAY_MS);
        }
      });

      socket.on('disconnect', (reason) => {
        debug('socket', `disconnect reason=${reason}`);
        // Safety net for WS drops that don't carry an explicit
        // session_error/session_closed event (Railway proxy idle timeout,
        // ADK crash that outraces the cleanup chain). Without this the UI
        // would stay stuck on "Listening" forever.
        stopMic();
        setSessionState((prev) => (prev === 'error' ? prev : 'idle'), 'ws disconnect');
      });

      socket.on('connect', () => {
        debug('socket', `connect → emit start_session sessionId=${sessionId ?? 'new'}`);
        socket.emit('start_session', { sessionId: sessionId ?? null });
      });
    },
    [startMic, stopMic, playAudio, appendTranscript, setSessionState, setActionType],
  );

  // Keep the _openRef synced to the latest _open instance so the inner
  // reconnect_failed handler's auto-retry can call the current closure.
  useEffect(() => {
    _openRef.current = _open;
  }, [_open]);

  // Public: user clicked the mic.
  const start = useCallback(
    (opts: StartOptions) => _open(opts, true),
    [_open],
  );

  // Public: background pre-warm on page mount. Opens the socket and runs
  // session setup (patient context build, gRPC stream, Gemini connect) while
  // the user is still reading the UI, so the first click has no setup delay.
  const prewarm = useCallback(
    (opts: StartOptions) => _open(opts, false),
    [_open],
  );

  const sendText = useCallback((text: string) => {
    if (!socketRef.current?.connected || !text.trim()) return;
    debug('sendText', `len=${text.length}`);
    socketRef.current.emit('text_input', { text });
    appendTranscript(text, 'user', true);
    setSessionState('processing', 'sendText');
  }, [appendTranscript, setSessionState]);

  const end = useCallback(async () => {
    debug('end', 'user end()');
    socketRef.current?.emit('end_session');
    await cleanup();
    setSessionState('idle', 'user end()');
    // Don't clear transcript here — AIChatInterface converts them to
    // permanent message bubbles when it detects the idle transition.
    setPendingCheckin(null);
    setPendingUpdate(null);
    setPendingDelete(null);
  }, [cleanup, setSessionState]);

  const dismissCheckin = useCallback(() => {
    debug('dismissCheckin', 'auto or user');
    setPendingCheckin(null);
    // Return to 'listening' (not 'idle') — the voice call continues so the
    // agent can speak its confirmation. Setting 'idle' here would trigger
    // the AIChatInterface idle transition and tear down the whole session.
    setSessionState(
      (prev) => (prev === 'checkin_confirm' ? 'listening' : prev),
      'dismissCheckin',
    );
  }, [setSessionState]);

  const clearTranscript = useCallback(() => {
    setTranscript([]);
  }, []);

  const dismissUpdate = useCallback(() => {
    debug('dismissUpdate', 'auto or user');
    setPendingUpdate(null);
  }, []);

  const dismissDelete = useCallback(() => {
    debug('dismissDelete', 'auto or user');
    setPendingDelete(null);
  }, []);

  return {
    sessionState,
    prewarmStatus,
    transcript,
    pendingCheckin,
    pendingUpdate,
    pendingDelete,
    errorMessage,
    actionType,
    start,
    prewarm,
    sendText,
    end,
    dismissCheckin,
    dismissUpdate,
    dismissDelete,
    clearTranscript,
  };
}
