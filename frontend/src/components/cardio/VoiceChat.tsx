'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, X, Send, CheckCircle, AlertCircle, PhoneCall } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  useVoiceSession,
  type SessionState,
  type TranscriptLine,
  type CheckinSummary,
} from '@/hooks/useVoiceSession';

// ── Sub-components ────────────────────────────────────────────────────────────

function PulsingOrb({ state }: { state: SessionState }) {
  const isListening = state === 'listening';
  const isSpeaking = state === 'agent_speaking';
  const isProcessing = state === 'processing';

  return (
    <div className="relative flex items-center justify-center w-28 h-28 mx-auto">
      {/* Outer pulse ring */}
      {(isListening || isSpeaking) && (
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background: isListening
              ? 'rgba(239,68,68,0.15)'
              : 'rgba(123,0,224,0.15)',
          }}
          animate={{ scale: [1, 1.35, 1] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      {/* Middle ring */}
      {(isListening || isSpeaking) && (
        <motion.div
          className="absolute rounded-full"
          style={{
            inset: '12px',
            background: isListening
              ? 'rgba(239,68,68,0.2)'
              : 'rgba(123,0,224,0.2)',
          }}
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }}
        />
      )}
      {/* Core circle */}
      <div
        className="relative z-10 w-16 h-16 rounded-full flex items-center justify-center"
        style={{
          background: isListening
            ? 'linear-gradient(135deg, #ef4444, #dc2626)'
            : isSpeaking
            ? 'linear-gradient(135deg, #7B00E0, #9333EA)'
            : isProcessing
            ? 'linear-gradient(135deg, #f59e0b, #d97706)'
            : 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
          boxShadow: isListening
            ? '0 4px 24px rgba(239,68,68,0.4)'
            : isSpeaking
            ? '0 4px 24px rgba(123,0,224,0.4)'
            : '0 4px 20px rgba(123,0,224,0.25)',
        }}
      >
        {isProcessing ? (
          <motion.div
            className="w-5 h-5 border-2 border-white rounded-full border-t-transparent"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
          />
        ) : isListening ? (
          <Mic className="w-7 h-7 text-white" />
        ) : (
          <MicOff className="w-6 h-6 text-white opacity-80" />
        )}
      </div>
    </div>
  );
}

function StateLabel({ state }: { state: SessionState }) {
  const labels: Record<SessionState, string> = {
    idle: 'Ready to start',
    connecting: 'Connecting…',
    ready: 'Connected',
    listening: 'Listening…',
    agent_speaking: 'AI is speaking',
    processing: 'Processing…',
    checkin_confirm: 'Check-in complete',
    error: 'Error',
  };
  const colors: Record<SessionState, string> = {
    idle: 'var(--brand-text-muted)',
    connecting: 'var(--brand-text-muted)',
    ready: 'var(--brand-accent-teal)',
    listening: '#ef4444',
    agent_speaking: 'var(--brand-primary-purple)',
    processing: '#f59e0b',
    checkin_confirm: 'var(--brand-success-green)',
    error: '#ef4444',
  };
  return (
    <p className="text-[13px] font-semibold text-center mt-3" style={{ color: colors[state] }}>
      {labels[state]}
    </p>
  );
}

function TranscriptArea({ lines }: { lines: TranscriptLine[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  if (lines.length === 0) return null;

  return (
    <div
      className="w-full max-w-md mx-auto rounded-2xl overflow-y-auto space-y-2 p-4"
      style={{
        maxHeight: '200px',
        backgroundColor: 'white',
        border: '1px solid var(--brand-border)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      }}
    >
      {lines.map((line) => (
        <div
          key={line.id}
          className={`flex ${line.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <span
            className="inline-block px-3 py-1.5 rounded-xl text-[13px] max-w-[85%]"
            style={{
              background:
                line.speaker === 'user'
                  ? 'linear-gradient(135deg, #7B00E0, #9333EA)'
                  : 'var(--brand-primary-purple-light)',
              color:
                line.speaker === 'user' ? 'white' : 'var(--brand-text-primary)',
              opacity: line.isFinal ? 1 : 0.65,
            }}
          >
            {line.text}
          </span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

function CheckinCard({
  summary,
  onDismiss,
}: {
  summary: CheckinSummary;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="w-full max-w-md mx-auto rounded-2xl p-5"
      style={{
        backgroundColor: 'white',
        border: '1.5px solid var(--brand-border)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.09)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        {summary.saved ? (
          <CheckCircle className="w-5 h-5" style={{ color: 'var(--brand-success-green)' }} />
        ) : (
          <AlertCircle className="w-5 h-5 text-red-500" />
        )}
        <p className="font-bold text-[15px]" style={{ color: 'var(--brand-text-primary)' }}>
          {summary.saved ? 'Check-in saved!' : 'Could not save check-in'}
        </p>
      </div>

      {/* Values */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {summary.systolicBP != null && summary.diastolicBP != null && (
          <div
            className="rounded-xl p-3 text-center"
            style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-1"
               style={{ color: 'var(--brand-text-muted)' }}>
              Blood Pressure
            </p>
            <p className="text-[18px] font-bold" style={{ color: 'var(--brand-primary-purple)' }}>
              {summary.systolicBP}/{summary.diastolicBP}
            </p>
            <p className="text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>mmHg</p>
          </div>
        )}

        {summary.weight != null && (
          <div
            className="rounded-xl p-3 text-center"
            style={{ backgroundColor: 'var(--brand-accent-teal-light)' }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-1"
               style={{ color: 'var(--brand-text-muted)' }}>
              Weight
            </p>
            <p className="text-[18px] font-bold" style={{ color: 'var(--brand-accent-teal)' }}>
              {summary.weight}
            </p>
            <p className="text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>lbs</p>
          </div>
        )}

        <div
          className="rounded-xl p-3 text-center"
          style={{
            backgroundColor: summary.medicationTaken
              ? 'var(--brand-success-green-light)'
              : 'var(--brand-alert-red-light)',
          }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-1"
             style={{ color: 'var(--brand-text-muted)' }}>
            Medications
          </p>
          <p
            className="text-[14px] font-bold"
            style={{
              color: summary.medicationTaken
                ? 'var(--brand-success-green)'
                : 'var(--brand-alert-red)',
            }}
          >
            {summary.medicationTaken ? 'Taken ✓' : 'Missed'}
          </p>
        </div>

        {summary.symptoms.length > 0 && (
          <div
            className="rounded-xl p-3 text-center"
            style={{ backgroundColor: 'var(--brand-warning-amber-light)' }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-1"
               style={{ color: 'var(--brand-text-muted)' }}>
              Symptoms
            </p>
            <p className="text-[12px] font-medium" style={{ color: 'var(--brand-warning-amber)' }}>
              {summary.symptoms.slice(0, 2).join(', ')}
              {summary.symptoms.length > 2 && ` +${summary.symptoms.length - 2}`}
            </p>
          </div>
        )}
      </div>

      <button
        onClick={onDismiss}
        className="w-full py-2.5 rounded-xl text-[14px] font-semibold transition hover:opacity-90 active:scale-[0.98]"
        style={{
          background: 'linear-gradient(135deg, #7B00E0, #9333EA)',
          color: 'white',
          boxShadow: '0 4px 14px rgba(123,0,224,0.28)',
        }}
      >
        Done
      </button>
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function VoiceChat({ onBack }: { onBack: () => void }) {
  const { token } = useAuth();
  const [mode, setMode] = useState<'checkin' | 'chat'>('chat');
  const [textInput, setTextInput] = useState('');

  const {
    sessionState,
    transcript,
    pendingCheckin,
    errorMessage,
    start,
    sendText,
    end,
    dismissCheckin,
  } = useVoiceSession();

  const isActive =
    sessionState !== 'idle' &&
    sessionState !== 'error' &&
    sessionState !== 'checkin_confirm';

  const canStart = sessionState === 'idle' || sessionState === 'error';

  const handleStart = async () => {
    if (!token) return;
    await start({ mode, token });
  };

  const handleSendText = () => {
    const t = textInput.trim();
    if (!t) return;
    sendText(t);
    setTextInput('');
  };

  const handleEnd = async () => {
    await end();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  };

  return (
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: 'var(--brand-background)' }}
    >
      {/* Header */}
      <div
        className="shrink-0 flex items-center justify-between px-4 lg:px-6 py-3.5 bg-white"
        style={{ borderBottom: '1px solid var(--brand-border)' }}
      >
        <div className="flex items-center gap-2">
          {/* Mode tabs */}
          <div
            className="flex items-center gap-1 p-1 rounded-xl"
            style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}
          >
            {(['chat', 'checkin'] as const).map((m) => (
              <button
                key={m}
                disabled={isActive}
                onClick={() => setMode(m)}
                className="px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all"
                style={{
                  backgroundColor:
                    mode === m ? 'var(--brand-primary-purple)' : 'transparent',
                  color: mode === m ? 'white' : 'var(--brand-primary-purple)',
                }}
              >
                {m === 'chat' ? 'Ask a question' : 'Check-in'}
              </button>
            ))}
          </div>

</div>

        {/* Back to text button */}
        <button
          onClick={async () => {
            if (isActive) await handleEnd();
            onBack();
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold transition hover:opacity-75"
          style={{
            backgroundColor: 'var(--brand-primary-purple-light)',
            color: 'var(--brand-primary-purple)',
          }}
        >
          <X className="w-3.5 h-3.5" />
          Text mode
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col items-center justify-center gap-5 px-4 py-6 overflow-y-auto">
        <AnimatePresence mode="wait">
          {sessionState === 'checkin_confirm' && pendingCheckin ? (
            <motion.div
              key="checkin"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full"
            >
              <CheckinCard summary={pendingCheckin} onDismiss={dismissCheckin} />
            </motion.div>
          ) : (
            <motion.div
              key="main"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-5 w-full"
            >
              {/* Orb */}
              <PulsingOrb state={sessionState} />
              <StateLabel state={sessionState} />

              {/* Error message */}
              {sessionState === 'error' && errorMessage && (
                <p
                  className="text-[13px] text-center max-w-xs px-4"
                  style={{ color: '#ef4444' }}
                >
                  {errorMessage}
                </p>
              )}

              {/* Idle instructions */}
              {canStart && (
                <p
                  className="text-[13px] text-center max-w-xs"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  {mode === 'checkin'
                    ? 'Tap start to record your blood pressure, weight, and medications by voice.'
                    : 'Tap start to ask your cardiovascular health assistant anything by voice.'}
                </p>
              )}

              {/* Transcript */}
              {transcript.length > 0 && <TranscriptArea lines={transcript} />}

              {/* Emergency notice */}
              {isActive && (
                <div
                  className="flex items-center gap-2 px-3 py-2 rounded-xl w-full max-w-md"
                  style={{
                    backgroundColor: 'var(--brand-alert-red-light)',
                    border: '1px solid rgba(239,68,68,0.2)',
                  }}
                >
                  <PhoneCall className="w-3.5 h-3.5 shrink-0" style={{ color: '#ef4444' }} />
                  <p className="text-[11px]" style={{ color: '#b91c1c' }}>
                    If you feel chest pain or severe shortness of breath, call 911 immediately.
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Controls */}
      <div
        className="shrink-0 bg-white px-4 lg:px-6 py-4 space-y-3"
        style={{ borderTop: '1px solid var(--brand-border)' }}
      >
        {/* Start / Stop button */}
        {sessionState !== 'checkin_confirm' && (
          <div className="flex justify-center">
            {canStart ? (
              <motion.button
                onClick={() => void handleStart()}
                className="flex items-center gap-2 px-8 py-3 rounded-2xl text-[14px] font-bold transition-all"
                style={{
                  background: 'linear-gradient(135deg, #7B00E0, #9333EA)',
                  color: 'white',
                  boxShadow: '0 4px 18px rgba(123,0,224,0.35)',
                }}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
              >
                <Mic className="w-4 h-4" />
                Start voice {mode === 'checkin' ? 'check-in' : 'chat'}
              </motion.button>
            ) : (
              <motion.button
                onClick={() => void handleEnd()}
                className="flex items-center gap-2 px-8 py-3 rounded-2xl text-[14px] font-bold"
                style={{
                  background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                  color: 'white',
                  boxShadow: '0 4px 18px rgba(239,68,68,0.3)',
                }}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
              >
                <MicOff className="w-4 h-4" />
                End session
              </motion.button>
            )}
          </div>
        )}

        {/* Text fallback input — shown while session is active */}
        {isActive && (
          <div
            className="flex items-center gap-2 px-4 py-2"
            style={{
              border: '1.5px solid var(--brand-border)',
              borderRadius: '28px',
              backgroundColor: 'var(--brand-background)',
            }}
          >
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Or type a message…"
              className="flex-1 bg-transparent text-[13px] outline-none py-1.5"
              style={{ color: 'var(--brand-text-primary)' }}
            />
            <button
              onClick={handleSendText}
              disabled={!textInput.trim()}
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-30 transition"
              style={{
                background: textInput.trim()
                  ? 'linear-gradient(135deg, #7B00E0, #9333EA)'
                  : 'var(--brand-border)',
              }}
            >
              <Send className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
        )}

        <p
          className="text-center text-[10px]"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          Powered by Gemini Live · Responses monitored by care team
        </p>
      </div>
    </div>
  );
}
