'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, X, Send, CheckCircle, AlertCircle, PhoneCall, Pencil, Trash2, Heart } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  useVoiceSession,
  type SessionState,
  type CheckinSummary,
} from '@/hooks/useVoiceSession';

// ── Sound Wave Bars ──────────────────────────────────────────────────────────

function SoundWave({ color, count = 5 }: { color: string; count?: number }) {
  return (
    <div className="flex items-center justify-center gap-[3px] h-8">
      {Array.from({ length: count }).map((_, i) => (
        <motion.div
          key={i}
          className="w-[3px] rounded-full"
          style={{ backgroundColor: color }}
          animate={{
            height: [8, 24 + Math.random() * 12, 8],
          }}
          transition={{
            duration: 0.6 + Math.random() * 0.4,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: i * 0.08,
          }}
        />
      ))}
    </div>
  );
}

// ── Animated Orb ─────────────────────────────────────────────────────────────

function VoiceOrb({ state }: { state: SessionState }) {
  const isListening = state === 'listening';
  const isSpeaking = state === 'agent_speaking';
  const isProcessing = state === 'processing';
  const isActive = isListening || isSpeaking;

  const orbColor = isListening
    ? '#ef4444'
    : isSpeaking
    ? '#7B00E0'
    : isProcessing
    ? '#f59e0b'
    : '#7B00E0';

  const orbGradient = isListening
    ? 'linear-gradient(135deg, #ef4444, #dc2626)'
    : isSpeaking
    ? 'linear-gradient(135deg, #7B00E0, #9333EA)'
    : isProcessing
    ? 'linear-gradient(135deg, #f59e0b, #d97706)'
    : 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)';

  return (
    <div className="relative flex items-center justify-center" style={{ width: 180, height: 180 }}>
      {/* Outer glow rings */}
      {isActive && (
        <>
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ background: `${orbColor}08` }}
            animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0, 0.4] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute rounded-full"
            style={{ inset: 16, background: `${orbColor}10` }}
            animate={{ scale: [1, 1.3, 1], opacity: [0.6, 0.1, 0.6] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
          />
          <motion.div
            className="absolute rounded-full"
            style={{ inset: 32, background: `${orbColor}18` }}
            animate={{ scale: [1, 1.2, 1], opacity: [0.8, 0.2, 0.8] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
          />
        </>
      )}

      {/* Processing ring */}
      {isProcessing && (
        <motion.div
          className="absolute rounded-full"
          style={{
            inset: 20,
            border: `3px solid transparent`,
            borderTopColor: orbColor,
            borderRightColor: `${orbColor}40`,
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
        />
      )}

      {/* Core orb */}
      <motion.div
        className="relative z-10 rounded-full flex items-center justify-center"
        style={{
          width: 96,
          height: 96,
          background: orbGradient,
          boxShadow: `0 8px 40px ${orbColor}50`,
        }}
        animate={isActive ? { scale: [1, 1.06, 1] } : { scale: 1 }}
        transition={isActive ? { duration: 1.4, repeat: Infinity, ease: 'easeInOut' } : {}}
      >
        {isProcessing ? (
          <motion.div
            className="w-8 h-8 border-3 border-white rounded-full border-t-transparent"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
          />
        ) : isSpeaking ? (
          <SoundWave color="white" count={5} />
        ) : isListening ? (
          <Mic className="w-10 h-10 text-white" />
        ) : (
          <Mic className="w-9 h-9 text-white opacity-70" />
        )}
      </motion.div>
    </div>
  );
}

// ── State Label ──────────────────────────────────────────────────────────────

function StateLabel({ state }: { state: SessionState }) {
  const config: Record<SessionState, { text: string; color: string; sub?: string }> = {
    idle: { text: 'Ready to talk', color: 'var(--brand-text-muted)', sub: 'Tap start to begin' },
    connecting: { text: 'Connecting...', color: 'var(--brand-text-muted)' },
    ready: { text: 'Connected', color: 'var(--brand-accent-teal)' },
    listening: { text: 'Listening to you', color: '#ef4444', sub: 'Speak naturally' },
    agent_speaking: { text: 'AI is speaking', color: 'var(--brand-primary-purple)', sub: 'Listening...' },
    processing: { text: 'Thinking...', color: '#f59e0b' },
    checkin_confirm: { text: 'Check-in saved', color: 'var(--brand-success-green)' },
    error: { text: 'Something went wrong', color: '#ef4444' },
  };
  const c = config[state];
  return (
    <div className="text-center">
      <motion.p
        key={state}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-[15px] font-bold"
        style={{ color: c.color }}
      >
        {c.text}
      </motion.p>
      {c.sub && (
        <p className="text-[12px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
          {c.sub}
        </p>
      )}
    </div>
  );
}

// ── CRUD Action Overlay ──────────────────────────────────────────────────────

function ActionOverlay({ type }: { type: string }) {
  const isDelete = type === 'deleting_checkin';
  const isUpdate = type === 'updating_checkin';
  const color = isDelete ? '#ef4444' : isUpdate ? '#7B00E0' : '#f59e0b';
  const gradient = isDelete
    ? 'linear-gradient(135deg, #ef4444, #dc2626)'
    : isUpdate ? 'linear-gradient(135deg, #7B00E0, #9333EA)'
    : 'linear-gradient(135deg, #f59e0b, #d97706)';
  const label = isDelete ? 'Deleting reading' : isUpdate ? 'Updating reading' : 'Saving check-in';
  const sub = isDelete ? 'Removing your entry...' : isUpdate ? 'Updating your entry...' : 'Recording your data...';
  const Icon = isDelete ? Trash2 : isUpdate ? Pencil : Heart;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-20 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(250,251,255,0.94)', backdropFilter: 'blur(8px)' }}
    >
      <div className="text-center">
        {/* Orbiting dots */}
        <div className="relative flex items-center justify-center mx-auto" style={{ width: 120, height: 120 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <motion.div
              key={i}
              className="absolute w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: color }}
              animate={{
                x: [Math.cos((i / 6) * Math.PI * 2) * 48, Math.cos(((i + 6) / 6) * Math.PI * 2) * 48],
                y: [Math.sin((i / 6) * Math.PI * 2) * 48, Math.sin(((i + 6) / 6) * Math.PI * 2) * 48],
                opacity: [0.2, 0.8, 0.2],
                scale: [0.6, 1.1, 0.6],
              }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'linear', delay: i * 0.15 }}
            />
          ))}
          <motion.div
            className="relative z-10 w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: gradient, boxShadow: `0 8px 32px ${color}40` }}
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          >
            <motion.div
              animate={isDelete ? { rotate: [0, -8, 8, 0] } : { rotate: 360 }}
              transition={isDelete ? { duration: 0.5, repeat: Infinity } : { duration: 2, repeat: Infinity, ease: 'linear' }}
            >
              <Icon className="w-7 h-7 text-white" />
            </motion.div>
          </motion.div>
        </div>

        <p className="text-[16px] font-bold mt-4" style={{ color }}>{label}</p>
        <p className="text-[12px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>{sub}</p>

        {/* Progress bar */}
        <div className="w-48 mx-auto mt-3 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: `${color}15` }}>
          <motion.div className="h-full rounded-full" style={{ backgroundColor: color }} animate={{ x: ['-100%', '100%'] }} transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }} />
        </div>
        <p className="text-[10px] mt-3" style={{ color: 'var(--brand-text-muted)' }}>AI will resume automatically</p>
      </div>
    </motion.div>
  );
}

// ── Check-in Success Card ────────────────────────────────────────────────────

function CheckinCard({
  summary,
  onDismiss,
}: {
  summary: CheckinSummary;
  onDismiss: () => void;
}) {
  // Auto-dismiss after 4 seconds
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      className="w-full max-w-sm mx-auto"
    >
      {/* Success animation */}
      <div className="text-center mb-5">
        <motion.div
          className="w-20 h-20 mx-auto rounded-full flex items-center justify-center"
          style={{
            background: summary.saved
              ? 'linear-gradient(135deg, #16A34A, #22c55e)'
              : 'linear-gradient(135deg, #ef4444, #dc2626)',
            boxShadow: summary.saved
              ? '0 8px 32px rgba(22,163,74,0.3)'
              : '0 8px 32px rgba(239,68,68,0.3)',
          }}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.1 }}
        >
          {summary.saved ? (
            <CheckCircle className="w-10 h-10 text-white" />
          ) : (
            <AlertCircle className="w-10 h-10 text-white" />
          )}
        </motion.div>
        <motion.p
          className="text-[17px] font-bold mt-3"
          style={{ color: 'var(--brand-text-primary)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          {summary.saved ? 'Check-in saved!' : 'Could not save'}
        </motion.p>
      </div>

      {/* Values grid */}
      <motion.div
        className="grid grid-cols-2 gap-2.5"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        {summary.systolicBP != null && summary.diastolicBP != null && (
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}>
            <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--brand-text-muted)' }}>
              Blood Pressure
            </p>
            <p className="text-[18px] font-bold" style={{ color: 'var(--brand-primary-purple)' }}>
              {summary.systolicBP}/{summary.diastolicBP}
            </p>
          </div>
        )}

        {summary.weight != null && summary.weight > 0 && (
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--brand-accent-teal-light)' }}>
            <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--brand-text-muted)' }}>
              Weight
            </p>
            <p className="text-[18px] font-bold" style={{ color: 'var(--brand-accent-teal)' }}>
              {summary.weight} <span className="text-[11px] font-medium">lbs</span>
            </p>
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
          <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--brand-text-muted)' }}>
            Medications
          </p>
          <p
            className="text-[14px] font-bold"
            style={{ color: summary.medicationTaken ? 'var(--brand-success-green)' : 'var(--brand-alert-red)' }}
          >
            {summary.medicationTaken ? 'Taken' : 'Missed'}
          </p>
        </div>

        {summary.symptoms.length > 0 && (
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--brand-warning-amber-light)' }}>
            <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--brand-text-muted)' }}>
              Symptoms
            </p>
            <p className="text-[11px] font-semibold" style={{ color: 'var(--brand-warning-amber)' }}>
              {summary.symptoms.slice(0, 2).join(', ')}
              {summary.symptoms.length > 2 && ` +${summary.symptoms.length - 2}`}
            </p>
          </div>
        )}
      </motion.div>

      {/* Auto-dismiss progress */}
      <motion.div
        className="mt-4 h-1 rounded-full overflow-hidden"
        style={{ backgroundColor: 'var(--brand-border)' }}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: summary.saved ? 'var(--brand-success-green)' : 'var(--brand-alert-red)' }}
          initial={{ width: '100%' }}
          animate={{ width: '0%' }}
          transition={{ duration: 4, ease: 'linear' }}
        />
      </motion.div>
      <p className="text-[10px] text-center mt-2" style={{ color: 'var(--brand-text-muted)' }}>
        Returning to conversation...
      </p>
    </motion.div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function VoiceChat({ onBack }: { onBack: () => void }) {
  const { token } = useAuth();
  const [mode, setMode] = useState<'checkin' | 'chat'>('chat');
  const [textInput, setTextInput] = useState('');

  const {
    sessionState,
    pendingCheckin,
    errorMessage,
    actionType,
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
    await start({ token });
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
      className="flex flex-col h-full relative"
      style={{ backgroundColor: '#FAFBFF' }}
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
                  backgroundColor: mode === m ? 'var(--brand-primary-purple)' : 'transparent',
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

      {/* CRUD Action Overlay */}
      <AnimatePresence>
        {actionType && <ActionOverlay type={actionType} />}
      </AnimatePresence>

      {/* Body */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-4 py-8">
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
              className="flex flex-col items-center gap-4 w-full"
            >
              {/* Orb */}
              <VoiceOrb state={sessionState} />

              {/* State label */}
              <StateLabel state={sessionState} />

              {/* Sound wave visualization when active */}
              <AnimatePresence>
                {(sessionState === 'listening' || sessionState === 'agent_speaking') && (
                  <motion.div
                    initial={{ opacity: 0, scaleY: 0 }}
                    animate={{ opacity: 1, scaleY: 1 }}
                    exit={{ opacity: 0, scaleY: 0 }}
                    className="flex items-center justify-center gap-4"
                  >
                    <SoundWave
                      color={sessionState === 'listening' ? 'rgba(239,68,68,0.5)' : 'rgba(123,0,224,0.5)'}
                      count={7}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Error message */}
              {sessionState === 'error' && errorMessage && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-[13px] text-center max-w-xs px-4"
                  style={{ color: '#ef4444' }}
                >
                  {errorMessage}
                </motion.p>
              )}

              {/* Idle instructions */}
              {canStart && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-[13px] text-center max-w-xs"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  {mode === 'checkin'
                    ? 'Tap start to record your blood pressure, weight, and medications by voice.'
                    : 'Tap start to talk with your cardiovascular health assistant.'}
                </motion.p>
              )}

              {/* Emergency notice */}
              {isActive && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl w-full max-w-sm"
                  style={{
                    backgroundColor: 'var(--brand-alert-red-light)',
                    border: '1px solid rgba(239,68,68,0.2)',
                  }}
                >
                  <PhoneCall className="w-3.5 h-3.5 shrink-0" style={{ color: '#ef4444' }} />
                  <p className="text-[11px]" style={{ color: '#b91c1c' }}>
                    If you feel chest pain or severe shortness of breath, call 911 immediately.
                  </p>
                </motion.div>
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
                className="flex items-center gap-2.5 px-10 py-3.5 rounded-2xl text-[14px] font-bold transition-all"
                style={{
                  background: 'linear-gradient(135deg, #7B00E0, #9333EA)',
                  color: 'white',
                  boxShadow: '0 6px 24px rgba(123,0,224,0.35)',
                }}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
              >
                <Mic className="w-5 h-5" />
                Start voice {mode === 'checkin' ? 'check-in' : 'chat'}
              </motion.button>
            ) : (
              <motion.button
                onClick={() => void handleEnd()}
                className="flex items-center gap-2.5 px-10 py-3.5 rounded-2xl text-[14px] font-bold"
                style={{
                  background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                  color: 'white',
                  boxShadow: '0 6px 24px rgba(239,68,68,0.3)',
                }}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
              >
                <MicOff className="w-5 h-5" />
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
              placeholder="Or type a message..."
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

        <p className="text-center text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>
          Powered by Gemini Live · Responses monitored by care team
        </p>
      </div>
    </div>
  );
}
