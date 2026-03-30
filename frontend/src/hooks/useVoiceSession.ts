'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

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

export interface StartOptions {
  mode: 'checkin' | 'chat';
  token: string;
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

export function useVoiceSession() {
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [pendingCheckin, setPendingCheckin] = useState<CheckinSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const socketRef = useRef<Socket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processorRef = useRef<any>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const transcriptIdRef = useRef(0);

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
    if (playbackContextRef.current) {
      await playbackContextRef.current.close().catch(() => {});
      playbackContextRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
  }, []);

  const stopMic = useCallback(() => {
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
  }, []);

  const startMic = useCallback(async () => {
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

    // ScriptProcessorNode — captures raw PCM and sends to backend
    const bufferSize = 4096;
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const processor = ctx.createScriptProcessor(bufferSize, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!socketRef.current?.connected) return;
      const float32 = e.inputBuffer.getChannelData(0);
      const int16 = floatTo16BitPCM(float32);
      const base64 = arrayBufferToBase64(int16.buffer as ArrayBuffer);
      socketRef.current.emit('audio_chunk', base64);
    };

    source.connect(processor);
    processor.connect(ctx.destination);
    setSessionState('listening');
  }, []);

  const playAudio = useCallback((audioBase64: string) => {
    const OUTPUT_SAMPLE_RATE = 24000;

    if (!playbackContextRef.current) {
      playbackContextRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    }

    const buffer = base64ToFloat32(audioBase64, OUTPUT_SAMPLE_RATE);
    if (!buffer) return;

    audioQueueRef.current.push(buffer);
    setSessionState('agent_speaking');

    if (!isPlayingRef.current) {
      playNextBuffer();
    }
  }, []);

  const playNextBuffer = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      // Only revert to 'listening' if we're still in agent_speaking
      setSessionState((prev) => (prev === 'agent_speaking' ? 'listening' : prev));
      return;
    }
    isPlayingRef.current = true;
    const buffer = audioQueueRef.current.shift()!;

    if (!playbackContextRef.current) return;
    const source = playbackContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(playbackContextRef.current.destination);
    source.onended = () => playNextBuffer();
    source.start();
  }, []);

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

  const start = useCallback(
    async ({ mode, token }: StartOptions) => {
      setSessionState('connecting');
      setTranscript([]);
      setPendingCheckin(null);
      setErrorMessage('');

      const wsUrl =
        process.env.NEXT_PUBLIC_VOICE_WS_URL ?? 'http://localhost:8080';

      const socket = io(`${wsUrl}/voice`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
      });
      socketRef.current = socket;

      socket.on('session_ready', async () => {
        try {
          await startMic();
        } catch {
          setSessionState('error');
          setErrorMessage('Microphone access denied. Please allow microphone access and try again.');
          socket.disconnect();
        }
      });

      socket.on('audio_response', (data: { audio: string }) => {
        playAudio(data.audio);
      });

      socket.on('transcript', (data: { text: string; isFinal: boolean; speaker: 'user' | 'agent' }) => {
        appendTranscript(data.text, data.speaker, data.isFinal);
      });

      socket.on('action', (data: { type: string; detail: string }) => {
        if (data.type === 'submitting_checkin') {
          setSessionState('processing');
        }
      });

      socket.on('checkin_saved', (summary: CheckinSummary) => {
        setPendingCheckin(summary);
        setSessionState('checkin_confirm');
        stopMic();
      });

      socket.on('session_error', (data: { message: string }) => {
        setErrorMessage(data.message);
        setSessionState('error');
        stopMic();
      });

      socket.on('session_closed', () => {
        stopMic();
        setSessionState('idle');
      });

      socket.on('connect_error', (err) => {
        setErrorMessage(`Connection failed: ${err.message}`);
        setSessionState('error');
      });

      socket.on('connect', () => {
        socket.emit('start_session', { mode });
      });
    },
    [startMic, stopMic, playAudio, appendTranscript],
  );

  const sendText = useCallback((text: string) => {
    if (!socketRef.current?.connected || !text.trim()) return;
    socketRef.current.emit('text_input', { text });
    appendTranscript(text, 'user', true);
    setSessionState('processing');
  }, [appendTranscript]);

  const end = useCallback(async () => {
    socketRef.current?.emit('end_session');
    await cleanup();
    setSessionState('idle');
    setTranscript([]);
    setPendingCheckin(null);
  }, [cleanup]);

  const dismissCheckin = useCallback(() => {
    setPendingCheckin(null);
    setSessionState('idle');
  }, []);

  return {
    sessionState,
    transcript,
    pendingCheckin,
    errorMessage,
    start,
    sendText,
    end,
    dismissCheckin,
  };
}
