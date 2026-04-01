'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Mic,
  MicOff,
  Plus,
  Menu,
  X,
  PhoneCall,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  sendMessage as sendChatMessage,
  getChatSessions,
  getSessionHistory,
  type ToolResult,
} from '@/lib/services/chat.service';
import {
  useVoiceSession,
  type TranscriptLine,
  type CheckinSummary,
  type UpdateSummary,
} from '@/hooks/useVoiceSession';

// ─── Types ────────────────────────────────────────────────────────────────────
type MessageSource = 'text' | 'voice';
type MessageType = 'ai' | 'patient' | 'teachback';

interface Message {
  id: number;
  type: MessageType;
  source: MessageSource;
  text: string;
  time: string;
}

interface Session {
  id: string;
  title: string;
  time: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatSessionTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) {
      return `Today, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } else if (d.toDateString() === yesterday.toDateString()) {
      return `Yesterday, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function formatMsgTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

function getUserInitials(name: string | null | undefined): string {
  if (!name) return 'U';
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

function nowTimeStr(): string {
  return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function SessionSkeleton() {
  return (
    <div className="space-y-1 px-1">
      {[75, 60, 80, 50].map((w, i) => (
        <div key={i} className="animate-pulse px-3 py-3 rounded-xl">
          <div className="h-3 rounded-full mb-2" style={{ backgroundColor: '#EDE9F6', width: `${w}%` }} />
          <div className="h-2 rounded-full" style={{ backgroundColor: '#EDE9F6', width: '42%' }} />
        </div>
      ))}
    </div>
  );
}

// ─── Typing indicator ─────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="flex items-end gap-2.5">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{ background: 'linear-gradient(135deg, #7b00e017, #9233ea43)', boxShadow: '0 2px 8px rgba(123,0,224,0.3)' }}
      >
        <Image src="/logo.svg" alt="Healplace" width={30} height={30} />
      </div>
      <div
        className="flex items-center gap-1.5 px-4 py-3.5"
        style={{ backgroundColor: 'white', borderRadius: '4px 18px 18px 18px', boxShadow: '0 2px 12px rgba(0,0,0,0.07)' }}
      >
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: 'var(--brand-primary-purple)' }}
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: Message }) {
  const { t } = useLanguage();
  const isVoice = msg.source === 'voice';

  if (msg.type === 'patient') {
    return (
      <motion.div
        className="flex justify-end"
        initial={{ opacity: 0, y: 8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        <div
          className="max-w-[75%] sm:max-w-[58%] px-4 py-3"
          style={{
            background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
            borderRadius: '18px 18px 4px 18px',
            boxShadow: '0 4px 14px rgba(123,0,224,0.25)',
          }}
        >
          <p className="text-[14px] leading-relaxed text-white">{msg.text}</p>
          <div className="flex items-center justify-end gap-1.5 mt-1.5">
            {isVoice && <Mic className="w-2.5 h-2.5" style={{ color: 'rgba(255,255,255,0.5)' }} />}
            <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.6)' }}>{msg.time}</p>
          </div>
        </div>
      </motion.div>
    );
  }

  if (msg.type === 'teachback') {
    return (
      <motion.div
        className="flex items-end gap-2.5"
        initial={{ opacity: 0, y: 8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #7b00e017, #9233ea43)' }}>
          <Image src="/logo.svg" alt="Healplace" width={30} height={30} />
        </div>
        <div
          className="max-w-[75%] sm:max-w-[65%] px-4 py-3.5"
          style={{ backgroundColor: 'var(--brand-accent-teal-light)', borderRadius: '4px 18px 18px 18px', borderLeft: '3px solid var(--brand-accent-teal)' }}
        >
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold mb-2" style={{ backgroundColor: 'var(--brand-accent-teal)', color: 'white' }}>
            {t('chat.checkinMode')}
          </span>
          <div className="prose prose-sm max-w-none text-[14px] leading-relaxed" style={{ color: 'var(--brand-text-primary)' }}>
            <ReactMarkdown>{msg.text}</ReactMarkdown>
          </div>
          <p className="text-[10px] mt-1.5 text-right" style={{ color: 'var(--brand-text-muted)' }}>{msg.time}</p>
        </div>
      </motion.div>
    );
  }

  // AI message
  return (
    <motion.div
      className="flex items-end gap-2.5"
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2 }}
    >
      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #7b00e017, #9233ea43)', boxShadow: '0 8px 28px rgba(123, 0, 224, 0.14)' }}>
        <Image src="/logo.svg" alt="Healplace" width={30} height={30} />
      </div>
      <div
        className="max-w-[75%] sm:max-w-[65%] px-4 py-3.5"
        style={{ backgroundColor: 'white', borderRadius: '4px 18px 18px 18px', boxShadow: '0 2px 12px rgba(0,0,0,0.07)' }}
      >
        <div className="prose prose-sm max-w-none text-[14px] leading-relaxed" style={{ color: 'var(--brand-text-primary)' }}>
          <ReactMarkdown>{msg.text}</ReactMarkdown>
        </div>
        <div className="flex items-center justify-end gap-1.5 mt-1.5">
          {isVoice && <Mic className="w-2.5 h-2.5" style={{ color: 'var(--brand-text-muted)' }} />}
          <p className="text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>{msg.time}</p>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Checkin result card ───────────────────────────────────────────────────────
function CheckinCard({ summary, onDismiss }: { summary: CheckinSummary; onDismiss: () => void }) {
  const { t } = useLanguage();
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="mx-auto w-full max-w-sm rounded-2xl p-5 my-2"
      style={{ backgroundColor: 'white', border: '1.5px solid var(--brand-border)', boxShadow: '0 4px 20px rgba(0,0,0,0.09)' }}
    >
      <div className="flex items-center gap-2 mb-4">
        {summary.saved
          ? <CheckCircle className="w-5 h-5" style={{ color: 'var(--brand-success-green)' }} />
          : <AlertCircle className="w-5 h-5 text-red-500" />}
        <p className="font-bold text-[15px]" style={{ color: 'var(--brand-text-primary)' }}>
          {summary.saved ? t('chat.checkinSaved') : t('chat.couldNotSave')}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        {summary.systolicBP != null && summary.diastolicBP != null && (
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--brand-text-muted)' }}>Blood Pressure</p>
            <p className="text-[18px] font-bold" style={{ color: 'var(--brand-primary-purple)' }}>{summary.systolicBP}/{summary.diastolicBP}</p>
            <p className="text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>mmHg</p>
          </div>
        )}
        {summary.weight != null && (
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--brand-accent-teal-light)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--brand-text-muted)' }}>Weight</p>
            <p className="text-[18px] font-bold" style={{ color: 'var(--brand-accent-teal)' }}>{summary.weight}</p>
            <p className="text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>lbs</p>
          </div>
        )}
        <div className="rounded-xl p-3 text-center" style={{ backgroundColor: summary.medicationTaken ? 'var(--brand-success-green-light)' : 'var(--brand-alert-red-light)' }}>
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--brand-text-muted)' }}>Medications</p>
          <p className="text-[14px] font-bold" style={{ color: summary.medicationTaken ? 'var(--brand-success-green)' : 'var(--brand-alert-red)' }}>
            {summary.medicationTaken ? 'Taken ✓' : 'Missed'}
          </p>
        </div>
        {summary.symptoms.length > 0 && (
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--brand-warning-amber-light)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--brand-text-muted)' }}>Symptoms</p>
            <p className="text-[12px] font-medium" style={{ color: 'var(--brand-warning-amber)' }}>
              {summary.symptoms.slice(0, 2).join(', ')}{summary.symptoms.length > 2 && ` +${summary.symptoms.length - 2}`}
            </p>
          </div>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="w-full py-2.5 rounded-xl text-[14px] font-semibold transition hover:opacity-90 active:scale-[0.98]"
        style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)', color: 'white', boxShadow: '0 4px 14px rgba(123,0,224,0.28)' }}
      >
        {t('chat.dismiss')}
      </button>
    </motion.div>
  );
}

// ─── Update result card ────────────────────────────────────────────────────────
function UpdateCard({ summary, onDismiss }: { summary: UpdateSummary; onDismiss: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="mx-auto w-full max-w-sm rounded-2xl p-5 my-2"
      style={{ backgroundColor: 'white', border: '1.5px solid var(--brand-border)', boxShadow: '0 4px 20px rgba(0,0,0,0.09)' }}
    >
      <div className="flex items-center gap-2 mb-4">
        {summary.updated
          ? <CheckCircle className="w-5 h-5" style={{ color: 'var(--brand-accent-teal)' }} />
          : <AlertCircle className="w-5 h-5 text-red-500" />}
        <p className="font-bold text-[15px]" style={{ color: 'var(--brand-text-primary)' }}>
          {summary.updated ? 'Reading updated!' : 'Could not update reading'}
        </p>
      </div>
      {summary.entryDate && (
        <p className="text-[12px] mb-3" style={{ color: 'var(--brand-text-muted)' }}>
          Entry for {new Date(summary.entryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {summary.systolicBP != null && summary.diastolicBP != null && (
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--brand-accent-teal-light)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--brand-text-muted)' }}>Blood Pressure</p>
            <p className="text-[18px] font-bold" style={{ color: 'var(--brand-accent-teal)' }}>{summary.systolicBP}/{summary.diastolicBP}</p>
            <p className="text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>mmHg</p>
          </div>
        )}
        {summary.weight != null && summary.weight > 0 && (
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--brand-accent-teal-light)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--brand-text-muted)' }}>Weight</p>
            <p className="text-[18px] font-bold" style={{ color: 'var(--brand-accent-teal)' }}>{summary.weight}</p>
            <p className="text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>lbs</p>
          </div>
        )}
        <div className="rounded-xl p-3 text-center" style={{ backgroundColor: summary.medicationTaken ? 'var(--brand-success-green-light)' : 'var(--brand-alert-red-light)' }}>
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--brand-text-muted)' }}>Medications</p>
          <p className="text-[14px] font-bold" style={{ color: summary.medicationTaken ? 'var(--brand-success-green)' : 'var(--brand-alert-red)' }}>
            {summary.medicationTaken ? 'Taken ✓' : 'Missed'}
          </p>
        </div>
        {summary.symptoms.length > 0 && (
          <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--brand-warning-amber-light)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--brand-text-muted)' }}>Symptoms</p>
            <p className="text-[12px] font-medium" style={{ color: 'var(--brand-warning-amber)' }}>
              {summary.symptoms.slice(0, 2).join(', ')}{summary.symptoms.length > 2 && ` +${summary.symptoms.length - 2}`}
            </p>
          </div>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="w-full py-2.5 rounded-xl text-[14px] font-semibold transition hover:opacity-90 active:scale-[0.98]"
        style={{ background: 'linear-gradient(135deg, #0D9488, #14B8A6)', color: 'white', boxShadow: '0 4px 14px rgba(13,148,136,0.28)' }}
      >
        Done
      </button>
    </motion.div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function SidebarContent({
  sessions, activeId, onSelect, onNewConversation, userInitials, userName, riskTier, isLoading,
}: {
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewConversation: () => void;
  userInitials: string;
  userName: string;
  riskTier: string;
  isLoading: boolean;
}) {
  const { t } = useLanguage();
  const riskColor =
    riskTier === 'HIGH'
      ? { bg: 'var(--brand-alert-red-light)', text: 'var(--brand-alert-red)' }
      : riskTier === 'ELEVATED'
      ? { bg: 'var(--brand-warning-amber-light)', text: 'var(--brand-warning-amber)' }
      : { bg: 'var(--brand-success-green-light)', text: 'var(--brand-success-green)' };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 pt-5 pb-3 shrink-0">
        <h2 className="text-[15px] font-bold mb-3" style={{ color: 'var(--brand-text-primary)' }}>{t('chat.conversations')}</h2>
        <button
          onClick={onNewConversation}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
          style={{ background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)', color: 'white', boxShadow: '0 4px 14px rgba(123,0,224,0.28)' }}
        >
          <Plus className="w-4 h-4" />
          {t('chat.newConversation')}
        </button>
      </div>

      <div className="px-4 pb-3 shrink-0">
        <div className="rounded-2xl p-3.5" style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[12px] font-bold shrink-0" style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}>
              {userInitials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold truncate" style={{ color: 'var(--brand-text-primary)' }}>{userName}</p>
              <p className="text-[11px] font-medium" style={{ color: 'var(--brand-accent-teal)' }}>{t('chat.patient')}</p>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0" style={{ backgroundColor: riskColor.bg, color: riskColor.text }}>
              {riskTier}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4 min-h-0">
        <p className="text-[10px] font-bold uppercase tracking-wider px-2 mb-2" style={{ color: 'var(--brand-text-muted)' }}>{t('chat.recent')}</p>
        {isLoading ? (
          <SessionSkeleton />
        ) : sessions.length === 0 ? (
          <p className="text-[12px] px-2 py-2" style={{ color: 'var(--brand-text-muted)' }}>{t('chat.noConversations')}</p>
        ) : (
          <div className="space-y-0.5">
            {sessions.map((s) => {
              const isActive = s.id === activeId;
              return (
                <button
                  key={s.id}
                  onClick={() => onSelect(s.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition-all cursor-pointer ${!isActive ? 'hover:bg-[#F3EEFB]' : ''}`}
                  style={{ backgroundColor: isActive ? 'var(--brand-primary-purple-light)' : undefined, borderLeft: isActive ? '2px solid var(--brand-primary-purple)' : '2px solid transparent' }}
                >
                  <p className="text-[13px] font-semibold truncate" style={{ color: isActive ? 'var(--brand-primary-purple)' : 'var(--brand-text-secondary)' }}>{s.title}</p>
                  <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--brand-text-muted)' }}>{s.time}</p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Voice call bar ───────────────────────────────────────────────────────────
function VoiceCallBar({
  state,
  onStop,
}: {
  state: 'connecting' | 'ready' | 'listening' | 'agent_speaking' | 'processing' | 'checkin_confirm';
  onStop: () => void;
}) {
  const { t } = useLanguage();
  const stateLabel: Record<string, string> = {
    connecting: t('chat.processing'),
    ready: t('chat.processing'),
    listening: t('chat.listening'),
    agent_speaking: t('chat.agentSpeaking'),
    processing: t('chat.processing'),
    checkin_confirm: t('chat.checkinSaved'),
  };
  const isListening = state === 'listening';
  const isSpeaking = state === 'agent_speaking';

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="shrink-0 flex items-center gap-3 px-4 lg:px-6 py-2.5"
      style={{ backgroundColor: '#F3EEFB', borderBottom: '1px solid var(--brand-border)' }}
    >
      {/* Animated dot */}
      <motion.div
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: isListening ? '#ef4444' : isSpeaking ? '#7B00E0' : '#f59e0b' }}
        animate={{ scale: isListening || isSpeaking ? [1, 1.4, 1] : 1 }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Mic className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-primary-purple)' }} />
        <span className="text-[12px] font-semibold" style={{ color: 'var(--brand-primary-purple)' }}>
          {t('chat.voiceMode')}
        </span>
        <span className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
          · {stateLabel[state] ?? state}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#b91c1c' }}>
          <PhoneCall className="w-3 h-3" />
          <span>{t('chat.emergencyCall')}</span>
        </div>
        <button
          onClick={onStop}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold transition hover:opacity-80"
          style={{ backgroundColor: '#ef4444', color: 'white' }}
        >
          <MicOff className="w-3 h-3" />
          {t('chat.endVoice')}
        </button>
      </div>
    </motion.div>
  );
}

// ─── Typing text effect ───────────────────────────────────────────────────────
function TypingText({ text, speaker }: { text: string; speaker: 'user' | 'agent' }) {
  const [displayed, setDisplayed] = useState('');
  const animatingRef = useRef(false);
  const targetRef = useRef('');
  const cursorRef = useRef(0);

  useEffect(() => {
    // If text is the same or shorter, just show it
    if (text.length <= cursorRef.current) {
      cursorRef.current = text.length;
      targetRef.current = text;
      setDisplayed(text);
      return;
    }

    // New text to animate
    targetRef.current = text;

    // If already animating, the existing interval will pick up the new target
    if (animatingRef.current) return;

    animatingRef.current = true;
    const interval = setInterval(() => {
      cursorRef.current++;
      const current = targetRef.current;
      setDisplayed(current.slice(0, cursorRef.current));
      if (cursorRef.current >= current.length) {
        clearInterval(interval);
        animatingRef.current = false;
      }
    }, 15);

    return () => {
      clearInterval(interval);
      animatingRef.current = false;
    };
  }, [text]);

  return (
    <p className="text-[14px] leading-relaxed" style={{ color: speaker === 'user' ? 'white' : 'var(--brand-text-primary)' }}>
      {displayed}
      {displayed.length < text.length && (
        <span className="inline-block w-[2px] h-[14px] ml-0.5 align-middle animate-pulse" style={{ backgroundColor: speaker === 'user' ? 'rgba(255,255,255,0.7)' : 'var(--brand-primary-purple)' }} />
      )}
    </p>
  );
}

// ─── Live transcript lines (shown during voice session) ───────────────────────
function LiveTranscriptBubbles({ lines }: { lines: TranscriptLine[] }) {
  if (lines.length === 0) return null;

  // Merge consecutive lines from the same speaker into single bubbles
  const merged: Array<{ speaker: 'user' | 'agent'; text: string; id: number }> = [];
  for (const line of lines) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === line.speaker) {
      last.text += ' ' + line.text;
    } else {
      merged.push({ speaker: line.speaker, text: line.text, id: line.id });
    }
  }

  return (
    <>
      {merged.map((group) => (
        <motion.div
          key={group.id}
          className={`flex ${group.speaker === 'user' ? 'justify-end' : 'justify-start items-end gap-2.5'}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
        >
          {group.speaker === 'agent' && (
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #7b00e017, #9233ea43)' }}>
              <Image src="/logo.svg" alt="Healplace" width={30} height={30} />
            </div>
          )}
          <div
            className="max-w-[75%] sm:max-w-[65%] px-4 py-3"
            style={{
              background: group.speaker === 'user'
                ? 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)'
                : 'white',
              borderRadius: group.speaker === 'user' ? '18px 18px 4px 18px' : '4px 18px 18px 18px',
              boxShadow: group.speaker === 'user'
                ? '0 4px 14px rgba(123,0,224,0.25)'
                : '0 2px 12px rgba(0,0,0,0.07)',
            }}
          >
            <TypingText text={group.text} speaker={group.speaker} />
            <div className="flex items-center justify-end gap-1 mt-1">
              <Mic className="w-2.5 h-2.5" style={{ color: group.speaker === 'user' ? 'rgba(255,255,255,0.5)' : 'var(--brand-text-muted)' }} />
            </div>
          </div>
        </motion.div>
      ))}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AIChatInterface() {
  const { user, token } = useAuth();
  const { t } = useLanguage();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [pendingCheckin, setPendingCheckin] = useState<CheckinSummary | null>(null);
  const [pendingUpdateCard, setPendingUpdateCard] = useState<UpdateSummary | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const userInitials = getUserInitials(user?.name);
  const userName = user?.name ?? 'Patient';
  const riskTier = user?.riskTier ?? 'STANDARD';

  // ── Voice session ──────────────────────────────────────────────────────────
  const handleVoiceSessionCreated = useCallback((newSessionId: string) => {
    // Backend created a new session for voice — adopt it
    setActiveSessionId(newSessionId);
    // Refresh session list
    getChatSessions()
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        setSessions(arr.map((s: { id: string; title: string; updatedAt: string; createdAt: string }) => ({
          id: s.id, title: s.title || 'Voice Session', time: formatSessionTime(s.updatedAt ?? s.createdAt),
        })));
      })
      .catch(() => {});
  }, []);

  const {
    sessionState: voiceState,
    transcript,
    pendingCheckin: voicePendingCheckin,
    errorMessage: voiceError,
    start: startVoice,
    end: endVoice,
    dismissCheckin,
    dismissUpdate,
    clearTranscript,
    pendingUpdate: voicePendingUpdate,
  } = useVoiceSession(handleVoiceSessionCreated);

  const isVoiceActive = voiceState !== 'idle' && voiceState !== 'error' && voiceState !== 'checkin_confirm';
  const isVoiceConnecting = voiceState === 'connecting';

  // When check-in is saved via voice, show the checkin card
  useEffect(() => {
    if (voicePendingCheckin) {
      setPendingCheckin(voicePendingCheckin);
    }
  }, [voicePendingCheckin]);

  // When a reading is updated via voice, show the update card
  useEffect(() => {
    if (voicePendingUpdate) {
      setPendingUpdateCard(voicePendingUpdate);
    }
  }, [voicePendingUpdate]);

  // When voice session ends, convert the live transcript lines into permanent messages
  // (keeps the full conversation visible instead of replacing with DB summaries)
  const prevVoiceStateRef = useRef(voiceState);
  useEffect(() => {
    const prev = prevVoiceStateRef.current;
    prevVoiceStateRef.current = voiceState;
    if (prev !== 'idle' && voiceState === 'idle' && transcript.length > 0) {
      // Convert live transcript lines into message bubbles
      const voiceMsgs: Message[] = transcript
        .filter((line) => line.text.trim())
        .map((line) => ({
          id: Date.now() + line.id,
          type: (line.speaker === 'user' ? 'patient' : 'ai') as MessageType,
          source: 'voice' as MessageSource,
          text: line.text,
          time: nowTimeStr(),
        }));
      if (voiceMsgs.length > 0) {
        setMessages((prev) => [...prev, ...voiceMsgs]);
      }
      // Clear live transcript lines now that they're converted to messages
      clearTranscript();
      // Refresh the session list in case a new session was created
      getChatSessions()
        .then((data) => {
          const arr = Array.isArray(data) ? data : [];
          setSessions(arr.map((s: { id: string; title: string; updatedAt: string; createdAt: string }) => ({
            id: s.id, title: s.title || 'Voice Session', time: formatSessionTime(s.updatedAt ?? s.createdAt),
          })));
        })
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState]);

  // ── Scroll ────────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, transcript]);

  // ── Load sessions ─────────────────────────────────────────────────────────
  useEffect(() => {
    setIsLoadingSessions(true);
    getChatSessions()
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        setSessions(arr.map((s: { id: string; title: string; updatedAt: string; createdAt: string }) => ({
          id: s.id, title: s.title || 'Conversation', time: formatSessionTime(s.updatedAt ?? s.createdAt),
        })));
      })
      .catch(() => {})
      .finally(() => setIsLoadingSessions(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load history ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }
    setIsLoadingHistory(true);
    setMessages([]);
    getSessionHistory(activeSessionId)
      .then((history) => {
        const arr = Array.isArray(history) ? history : [];
        const msgs: Message[] = [];
        arr.forEach((item: { id: string; userMessage: string; aiSummary: string; source: string; timestamp: string }, idx: number) => {
          msgs.push({ id: idx * 2, type: 'patient', source: 'text', text: item.userMessage, time: formatMsgTime(item.timestamp) });
          msgs.push({ id: idx * 2 + 1, type: 'ai', source: 'text', text: item.aiSummary, time: formatMsgTime(item.timestamp) });
        });
        setMessages(msgs);
      })
      .catch(() => setMessages([]))
      .finally(() => setIsLoadingHistory(false));
  }, [activeSessionId]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || isSending) return;

    const userMsg: Message = { id: Date.now(), type: 'patient', source: 'text', text, time: nowTimeStr() };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsTyping(true);
    setIsSending(true);

    try {
      const response = await sendChatMessage(text, activeSessionId ?? undefined);
      setIsTyping(false);

      if (!activeSessionId && response.sessionId) {
        setActiveSessionId(response.sessionId);
        getChatSessions()
          .then((data) => {
            const arr = Array.isArray(data) ? data : [];
            setSessions(arr.map((s: { id: string; title: string; updatedAt: string; createdAt: string }) => ({
              id: s.id, title: s.title || 'Conversation', time: formatSessionTime(s.updatedAt ?? s.createdAt),
            })));
          })
          .catch(() => {});
      }

      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, type: response.isEmergency ? 'teachback' : 'ai', source: 'text', text: response.data, time: nowTimeStr() },
      ]);

      // Show popup cards for tool results (checkin saved, updated, etc.)
      if (response.toolResults) {
        for (const tr of response.toolResults) {
          if (tr.tool === 'submit_checkin' && tr.result.saved) {
            const d = tr.result.data;
            setPendingCheckin({
              systolicBP: d?.systolicBP,
              diastolicBP: d?.diastolicBP,
              weight: d?.weight,
              medicationTaken: d?.medicationTaken,
              symptoms: d?.symptoms ?? [],
              saved: true,
            });
          } else if (tr.tool === 'update_checkin' && tr.result.updated) {
            const d = tr.result.data;
            setPendingUpdateCard({
              entryId: d?.id ?? '',
              entryDate: d?.entryDate,
              systolicBP: d?.systolicBP,
              diastolicBP: d?.diastolicBP,
              weight: d?.weight,
              medicationTaken: d?.medicationTaken,
              symptoms: d?.symptoms ?? [],
              updated: true,
            });
          }
        }
      }
    } catch {
      setIsTyping(false);
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, type: 'ai', source: 'text', text: t('chat.errorConnect'), time: nowTimeStr() },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleNewConversation = () => {
    setActiveSessionId(null);
    setMessages([]);
    setShowSessions(false);
  };

  const handleSelectSession = (id: string) => {
    setActiveSessionId(id);
    setShowSessions(false);
  };

  const handleMicClick = async () => {
    if (isVoiceActive || isVoiceConnecting) {
      await endVoice();
    } else if (token) {
      await startVoice({ token, sessionId: activeSessionId ?? undefined });
    }
  };

  const handleDismissCheckin = () => {
    setPendingCheckin(null);
    dismissCheckin();
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex" style={{ height: 'calc(100vh - 4rem)', backgroundColor: 'var(--brand-background)' }}>
      {/* ── Desktop Sidebar ───────────────────────────────────────────────── */}
      <div className="hidden lg:flex flex-col w-72 shrink-0 h-full" style={{ backgroundColor: 'white', borderRight: '1px solid var(--brand-border)' }}>
        <SidebarContent
          sessions={sessions} activeId={activeSessionId} onSelect={handleSelectSession}
          onNewConversation={handleNewConversation} userInitials={userInitials}
          userName={userName} riskTier={riskTier} isLoading={isLoadingSessions}
        />
      </div>

      {/* ── Mobile Drawer ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showSessions && (
          <>
            <motion.div className="lg:hidden fixed inset-0 z-40 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowSessions(false)} />
            <motion.div
              className="lg:hidden fixed top-16 left-0 bottom-0 z-50 w-72 flex flex-col"
              style={{ backgroundColor: 'white', boxShadow: '4px 0 24px rgba(0,0,0,0.14)' }}
              initial={{ x: -288 }} animate={{ x: 0 }} exit={{ x: -288 }}
              transition={{ type: 'spring', stiffness: 360, damping: 34 }}
            >
              <button onClick={() => setShowSessions(false)} className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center z-10 transition hover:bg-gray-100" style={{ backgroundColor: 'var(--brand-background)' }}>
                <X className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
              </button>
              <SidebarContent
                sessions={sessions} activeId={activeSessionId} onSelect={handleSelectSession}
                onNewConversation={handleNewConversation} userInitials={userInitials}
                userName={userName} riskTier={riskTier} isLoading={isLoadingSessions}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Chat area ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Header */}
        <div className="bg-white flex items-center gap-3 px-4 lg:px-6 py-3.5 shrink-0" style={{ borderBottom: '1px solid var(--brand-border)', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
          <button className="lg:hidden p-1.5 rounded-lg transition hover:bg-gray-50 shrink-0" onClick={() => setShowSessions(true)}>
            <Menu className="w-5 h-5" style={{ color: 'var(--brand-text-muted)' }} />
          </button>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #7b00e017, #9233ea43)', boxShadow: '0 8px 28px rgba(123, 0, 224, 0.14)' }}>
              <Image src="/logo.svg" alt="Healplace" width={30} height={30} />
            </div>
            <div>
              <p className="text-[14px] font-semibold leading-tight" style={{ color: 'var(--brand-text-primary)' }}>{t('chat.title')}</p>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                <span className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>{t('chat.onlineMonitored')}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ backgroundColor: 'var(--brand-accent-teal-light)', color: 'var(--brand-accent-teal)' }}>
              {t('chat.contextLoaded')}
            </span>
            <button className="lg:hidden w-8 h-8 rounded-full flex items-center justify-center transition hover:opacity-85 active:scale-95" style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }} onClick={handleNewConversation}>
              <Plus className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>

        {/* Voice call bar */}
        <AnimatePresence>
          {(isVoiceActive || isVoiceConnecting) && (
            <VoiceCallBar
              state={voiceState as 'connecting' | 'ready' | 'listening' | 'agent_speaking' | 'processing' | 'checkin_confirm'}
              onStop={() => void endVoice()}
            />
          )}
        </AnimatePresence>

        {/* Voice error banner */}
        <AnimatePresence>
          {voiceState === 'error' && voiceError && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="shrink-0 px-4 lg:px-6 py-2 text-[12px]"
              style={{ backgroundColor: '#FEF2F2', borderBottom: '1px solid #FECACA', color: '#b91c1c' }}
            >
              Voice error: {voiceError}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5 space-y-4 min-h-0" style={{ backgroundColor: 'var(--brand-background)' }}>
          {isLoadingHistory && (
            <div className="space-y-4 py-4">
              <div className="flex justify-end"><div className="animate-pulse rounded-2xl px-4 py-3" style={{ backgroundColor: 'var(--brand-primary-purple-light)', width: '65%' }}><div className="h-3 rounded-full mb-2" style={{ backgroundColor: '#E9D5FF', width: '80%', marginLeft: 'auto' }} /><div className="h-3 rounded-full" style={{ backgroundColor: '#E9D5FF', width: '50%', marginLeft: 'auto' }} /></div></div>
              <div className="flex justify-start"><div className="animate-pulse rounded-2xl px-4 py-3 bg-white" style={{ width: '75%' }}><div className="h-3 rounded-full mb-2" style={{ backgroundColor: '#EDE9F6', width: '90%' }} /><div className="h-3 rounded-full" style={{ backgroundColor: '#EDE9F6', width: '60%' }} /></div></div>
            </div>
          )}

          {messages.length === 0 && transcript.length === 0 && !isTyping && !isLoadingHistory && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-xs mx-auto">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'linear-gradient(135deg, #7b00e017, #9233ea43)', boxShadow: '0 8px 28px rgba(123, 0, 224, 0.14)' }}>
                  <Image src="/logo.svg" alt="Healplace" width={50} height={50} />
                </div>
                <p className="text-[16px] font-bold mb-1.5" style={{ color: 'var(--brand-text-primary)' }}>{t('chat.howCanIHelp')}</p>
                <p className="text-[13px] leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
                  {t('chat.askMe')}
                </p>
                <div className="flex flex-wrap gap-2 justify-center mt-5">
                  {[t('chat.chipBP'), t('chat.chipMeds'), t('chat.chipCheckin'), t('chat.chipHowAmI')].map((chip) => (
                    <button
                      key={chip}
                      onClick={() => setInputValue(chip)}
                      className="px-3 py-1.5 rounded-full text-[12px] font-semibold transition hover:opacity-80 active:scale-95"
                      style={{ backgroundColor: 'var(--brand-primary-purple-light)', color: 'var(--brand-primary-purple)', border: '1px solid #E9D5FF' }}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}

          {/* Live voice transcript — visible during and after voice session */}
          {transcript.length > 0 && (
            <LiveTranscriptBubbles lines={transcript} />
          )}

          {/* Check-in result card */}
          <AnimatePresence>
            {pendingCheckin && (
              <motion.div key="checkin" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <CheckinCard summary={pendingCheckin} onDismiss={handleDismissCheckin} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Update result card */}
          <AnimatePresence>
            {pendingUpdateCard && (
              <motion.div key="update" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <UpdateCard summary={pendingUpdateCard} onDismiss={() => { setPendingUpdateCard(null); dismissUpdate(); }} />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {isTyping && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
                <TypingIndicator />
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div className="shrink-0 bg-white px-4 lg:px-6 pt-3 pb-4" style={{ borderTop: '1px solid var(--brand-border)' }}>
          <div
            className="flex items-center gap-2 px-4 py-1.5 transition-all"
            style={{
              border: isVoiceActive ? '1.5px solid var(--brand-primary-purple)' : '1.5px solid var(--brand-border)',
              borderRadius: '28px',
              backgroundColor: 'var(--brand-background)',
            }}
          >
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isVoiceActive ? 'End voice call to type…' : 'Type a message…'}
              className="flex-1 bg-transparent text-[14px] outline-none min-w-0 py-2"
              style={{
                color: 'var(--brand-text-primary)',
                opacity: isVoiceActive ? 0.4 : 1,
              }}
              disabled={isSending || isVoiceActive || isVoiceConnecting}
            />

            {/* Mic button — disabled while text is sending */}
            <motion.button
              onClick={() => void handleMicClick()}
              disabled={!token || isSending}
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition disabled:opacity-40"
              style={{
                background: isVoiceActive
                  ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                  : isVoiceConnecting
                  ? '#f59e0b'
                  : 'var(--brand-primary-purple-light)',
              }}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              title={isVoiceActive ? t('chat.endVoice') : t('chat.startVoice')}
            >
              {isVoiceActive
                ? <MicOff className="w-3.5 h-3.5 text-white" />
                : <Mic className="w-3.5 h-3.5" style={{ color: isVoiceConnecting ? 'white' : 'var(--brand-primary-purple)' }} />
              }
            </motion.button>

            {/* Send button — disabled during voice */}
            <motion.button
              onClick={() => void handleSend()}
              disabled={isSending || !inputValue.trim() || isVoiceActive || isVoiceConnecting}
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 disabled:opacity-40"
              style={{
                background: inputValue.trim() ? 'linear-gradient(135deg, #7B00E0, #9333EA)' : 'var(--brand-border)',
                boxShadow: inputValue.trim() ? '0 4px 14px rgba(123,0,224,0.35)' : 'none',
                transition: 'background 0.2s, box-shadow 0.2s',
              }}
              whileHover={inputValue.trim() ? { scale: 1.08 } : {}}
              whileTap={inputValue.trim() ? { scale: 0.92 } : {}}
            >
              <Send className="w-3.5 h-3.5 text-white" />
            </motion.button>
          </div>

          <p className="text-center text-[10px] mt-2" style={{ color: 'var(--brand-text-muted)' }}>
            {t('chat.footer')}
          </p>
        </div>
      </div>
    </div>
  );
}
