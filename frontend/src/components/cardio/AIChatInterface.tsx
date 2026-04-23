'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
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
  Trash2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  sendMessage as sendChatMessage,
  getChatSessions,
  getSession as getSessionApi,
  getSessionHistory,
  deleteSession as deleteSessionApi,
  type ToolResult,
} from '@/lib/services/chat.service';
import {
  useVoiceSession,
  type SessionState,
  type TranscriptLine,
  type CheckinSummary,
  type UpdateSummary,
  type DeleteSummary,
} from '@/hooks/useVoiceSession';

// ── Debug logging (mirrors useVoiceSession helper) ───────────────────────────
const VOICE_DEBUG =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_VOICE_DEBUG === '1';
function voiceDebug(tag: string, ...args: unknown[]) {
  if (VOICE_DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`[VOICE ${tag}]`, ...args);
  }
}

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
  isVoice?: boolean;
  summary?: string | null;
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
        <Image src="/logo.svg" alt="Cardioplace" width={30} height={30} />
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
          <Image src="/logo.svg" alt="Cardioplace" width={30} height={30} />
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
        <Image src="/logo.svg" alt="Cardioplace" width={30} height={30} />
      </div>
      <div
        className="max-w-[80%] sm:max-w-[70%] px-4 py-3.5"
        style={{ backgroundColor: 'white', borderRadius: '4px 18px 18px 18px', boxShadow: '0 2px 12px rgba(0,0,0,0.07)' }}
      >
        {isVoice && (
          <div className="flex items-center gap-1.5 mb-2">
            <Mic className="w-3 h-3" style={{ color: 'var(--brand-primary-purple)' }} />
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold"
              style={{ backgroundColor: 'var(--brand-primary-purple-light)', color: 'var(--brand-primary-purple)' }}
            >
              Voice Session Summary
            </span>
          </div>
        )}
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

// ─── Sidebar scrollbar styles ─────────────────────────────────────────────────
const sidebarScrollStyles = `
.sidebar-scroll::-webkit-scrollbar { width: 5px; }
.sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
.sidebar-scroll::-webkit-scrollbar-thumb { background: #E0D4F5; border-radius: 99px; }
.sidebar-scroll::-webkit-scrollbar-thumb:hover { background: #C4B0E0; }
.sidebar-scroll { scrollbar-width: thin; scrollbar-color: #E0D4F5 transparent; }
`;

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────
function DeleteConfirmModal({
  sessionTitle,
  onConfirm,
  onCancel,
  deleting,
}: {
  sessionTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onCancel}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        className="bg-white rounded-2xl w-full max-w-xs overflow-hidden"
        style={{ boxShadow: '0 24px 48px rgba(123,0,224,0.15)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 text-center">
          <div
            className="w-14 h-14 mx-auto mb-3 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'var(--brand-alert-red-light)' }}
          >
            <Trash2 className="w-6 h-6" style={{ color: 'var(--brand-alert-red)' }} />
          </div>
          <p className="text-[15px] font-bold mb-1" style={{ color: 'var(--brand-text-primary)' }}>
            Delete conversation?
          </p>
          <p className="text-[12px] leading-relaxed mb-4" style={{ color: 'var(--brand-text-muted)' }}>
            &ldquo;{sessionTitle.length > 30 ? sessionTitle.slice(0, 30) + '…' : sessionTitle}&rdquo; will be permanently deleted.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              disabled={deleting}
              className="flex-1 h-10 rounded-xl text-[13px] font-semibold transition hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: 'var(--brand-background)', color: 'var(--brand-text-secondary)', border: '1px solid var(--brand-border)' }}
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={deleting}
              className="flex-1 h-10 rounded-xl text-[13px] font-bold text-white transition hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1.5"
              style={{ backgroundColor: 'var(--brand-alert-red)' }}
            >
              {deleting ? (
                <motion.div
                  className="w-4 h-4 border-2 border-white rounded-full border-t-transparent"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
                />
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function SidebarContent({
  sessions, activeId, onSelect, onNewConversation, onDeleteSession, userInitials, userName, riskTier, isLoading,
}: {
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewConversation: () => void;
  onDeleteSession: (id: string) => void;
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
      <style>{sidebarScrollStyles}</style>
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

      <div className="flex-1 overflow-y-auto px-3 pb-4 min-h-0 sidebar-scroll">
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
                <div
                  key={s.id}
                  className={`group relative w-full text-left px-3 py-2.5 rounded-xl transition-all cursor-pointer ${!isActive ? 'hover:bg-[#F3EEFB]' : ''}`}
                  style={{ backgroundColor: isActive ? 'var(--brand-primary-purple-light)' : undefined, borderLeft: isActive ? '2px solid var(--brand-primary-purple)' : '2px solid transparent' }}
                  onClick={() => onSelect(s.id)}
                >
                  <div className="flex items-center gap-1.5 pr-6">
                    {s.isVoice && <Mic className="w-3 h-3 shrink-0" style={{ color: isActive ? 'var(--brand-primary-purple)' : 'var(--brand-text-muted)' }} />}
                    <p className="text-[13px] font-semibold truncate" style={{ color: isActive ? 'var(--brand-primary-purple)' : 'var(--brand-text-secondary)' }}>{s.title}</p>
                  </div>
                  <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--brand-text-muted)' }}>{s.isVoice ? `🎙 ${s.time}` : s.time}</p>
                  {/* Delete button — visible on hover */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteSession(s.id); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center hover:bg-red-50 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" style={{ color: 'var(--brand-alert-red)' }} />
                  </button>
                </div>
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
              <Image src="/logo.svg" alt="Cardioplace" width={30} height={30} />
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

// ─── Voice Active Screen (replaces chat area during voice) ────────────────────

function VoiceActiveScreen({ state, pendingCheckin, onDismissCheckin, pendingUpdate, onDismissUpdate, pendingDelete, onDismissDelete, actionType }: {
  state: SessionState;
  pendingCheckin: CheckinSummary | null;
  onDismissCheckin: () => void;
  pendingUpdate: UpdateSummary | null;
  onDismissUpdate: () => void;
  pendingDelete: DeleteSummary | null;
  onDismissDelete: () => void;
  actionType: string | null;
}) {
  const isConnecting = state === 'connecting' || state === 'ready';
  const isListening = state === 'listening';
  const isSpeaking = state === 'agent_speaking';
  const isProcessing = state === 'processing';
  const isCheckin = state === 'checkin_confirm';
  const isActive = isListening || isSpeaking;

  useEffect(() => {
    voiceDebug('VoiceActiveScreen', `render state=${state} actionType=${actionType ?? 'null'} pendingCheckin=${!!pendingCheckin} pendingUpdate=${!!pendingUpdate} pendingDelete=${!!pendingDelete}`);
  }, [state, actionType, pendingCheckin, pendingUpdate, pendingDelete]);

  useEffect(() => {
    if (!pendingUpdate) return;
    const timer = setTimeout(onDismissUpdate, 3000);
    return () => clearTimeout(timer);
  }, [pendingUpdate, onDismissUpdate]);

  useEffect(() => {
    if (!pendingDelete) return;
    const timer = setTimeout(onDismissDelete, 3000);
    return () => clearTimeout(timer);
  }, [pendingDelete, onDismissDelete]);

  const orbColor = isListening ? '#ef4444' : isSpeaking ? '#7B00E0' : isProcessing ? '#f59e0b' : '#7B00E0';
  const orbGradient = isListening
    ? 'linear-gradient(135deg, #ef4444, #dc2626)'
    : isSpeaking ? 'linear-gradient(135deg, #7B00E0, #9333EA)'
    : isProcessing ? 'linear-gradient(135deg, #f59e0b, #d97706)'
    : 'linear-gradient(135deg, #7B00E0, #9333EA)';

  // Auto-dismiss checkin after 3s — AI resumes talking, no user action needed
  useEffect(() => {
    if (!isCheckin || !pendingCheckin) return;
    const timer = setTimeout(onDismissCheckin, 3000);
    return () => clearTimeout(timer);
  }, [isCheckin, pendingCheckin, onDismissCheckin]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 relative overflow-hidden" style={{ backgroundColor: '#FAFBFF' }}>

      {/* Background ambient glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div
          className="absolute rounded-full"
          style={{ width: 400, height: 400, left: '50%', top: '50%', x: '-50%', y: '-50%', background: `radial-gradient(circle, ${orbColor}06 0%, transparent 70%)` }}
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <AnimatePresence mode="wait">

        {/* ── CONNECTING / TURNING ON ── */}
        {isConnecting && (
          <motion.div
            key="connecting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            className="relative z-10 flex flex-col items-center"
          >
            {/* Expanding rings animation */}
            <div className="relative flex items-center justify-center" style={{ width: 160, height: 160 }}>
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="absolute rounded-full"
                  style={{ inset: 20 + i * 8, border: '2px solid var(--brand-primary-purple)', opacity: 0 }}
                  animate={{ scale: [0.5, 1.4], opacity: [0.6, 0] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut', delay: i * 0.5 }}
                />
              ))}
              {/* Core orb growing in */}
              <motion.div
                className="relative z-10 rounded-full flex items-center justify-center"
                style={{ width: 80, height: 80, background: 'linear-gradient(135deg, #7B00E0, #9333EA)', boxShadow: '0 8px 40px rgba(123,0,224,0.35)' }}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 180, damping: 14 }}
              >
                <motion.div
                  className="w-8 h-8 border-[3px] border-white rounded-full"
                  style={{ borderTopColor: 'transparent' }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                />
              </motion.div>
            </div>

            <motion.div
              className="text-center mt-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <p className="text-[16px] font-bold" style={{ color: 'var(--brand-primary-purple)' }}>
                {state === 'connecting' ? 'Turning on...' : 'Starting mic...'}
              </p>
              <p className="text-[12px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
                Setting up your voice assistant
              </p>
              <div className="flex items-center justify-center gap-1.5 mt-3">
                {[0, 1, 2, 3].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: 'var(--brand-primary-purple)' }}
                    animate={{ opacity: [0.15, 1, 0.15] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* ── CHECKIN SAVED ── auto-dismisses, no user action needed */}
        {isCheckin && pendingCheckin && (
          <motion.div
            key="checkin-result"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            className="relative z-10 text-center w-full max-w-xs"
          >
            <motion.div
              className="w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-4"
              style={{
                background: pendingCheckin.saved
                  ? 'linear-gradient(135deg, #16A34A, #22c55e)'
                  : 'linear-gradient(135deg, #ef4444, #dc2626)',
                boxShadow: pendingCheckin.saved
                  ? '0 8px 32px rgba(22,163,74,0.3)'
                  : '0 8px 32px rgba(239,68,68,0.3)',
              }}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 12 }}
            >
              {pendingCheckin.saved ? (
                <CheckCircle className="w-10 h-10 text-white" />
              ) : (
                <AlertCircle className="w-10 h-10 text-white" />
              )}
            </motion.div>

            <p className="text-[17px] font-bold mb-3" style={{ color: 'var(--brand-text-primary)' }}>
              {pendingCheckin.saved ? 'Check-in saved!' : 'Could not save'}
            </p>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {pendingCheckin.systolicBP != null && pendingCheckin.diastolicBP != null && (
                <div className="rounded-xl p-2.5 text-center" style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}>
                  <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--brand-text-muted)' }}>BP</p>
                  <p className="text-[16px] font-bold" style={{ color: 'var(--brand-primary-purple)' }}>{pendingCheckin.systolicBP}/{pendingCheckin.diastolicBP}</p>
                </div>
              )}
              <div className="rounded-xl p-2.5 text-center" style={{ backgroundColor: pendingCheckin.medicationTaken ? 'var(--brand-success-green-light)' : 'var(--brand-alert-red-light)' }}>
                <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--brand-text-muted)' }}>Meds</p>
                <p className="text-[13px] font-bold" style={{ color: pendingCheckin.medicationTaken ? 'var(--brand-success-green)' : 'var(--brand-alert-red)' }}>{pendingCheckin.medicationTaken ? 'Taken' : 'Missed'}</p>
              </div>
            </div>

            {/* Auto-dismiss countdown */}
            <motion.div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--brand-border)' }}>
              <motion.div className="h-full rounded-full" style={{ backgroundColor: 'var(--brand-success-green)' }} initial={{ width: '100%' }} animate={{ width: '0%' }} transition={{ duration: 3, ease: 'linear' }} />
            </motion.div>
            <p className="text-[10px] mt-2" style={{ color: 'var(--brand-text-muted)' }}>AI will continue talking...</p>
          </motion.div>
        )}

        {/* ── CRUD / PROCESSING ── different animation per action type */}
        {isProcessing && (() => {
          const isDelete = actionType === 'deleting_checkin';
          const isUpdate = actionType === 'updating_checkin';
          const crudColor = isDelete ? '#ef4444' : isUpdate ? '#7B00E0' : '#f59e0b';
          const crudGradient = isDelete
            ? 'linear-gradient(135deg, #ef4444, #dc2626)'
            : isUpdate ? 'linear-gradient(135deg, #7B00E0, #9333EA)'
            : 'linear-gradient(135deg, #f59e0b, #d97706)';
          const crudLabel = isDelete ? 'Deleting reading' : isUpdate ? 'Updating reading' : 'Saving check-in';
          const crudSub = isDelete ? 'Removing your entry...' : isUpdate ? 'Updating your entry...' : 'Recording your data...';
          const CrudIcon = isDelete ? X : isUpdate ? AlertCircle : CheckCircle;

          return (
            <motion.div
              key={`processing-${actionType}`}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="relative z-10 flex flex-col items-center"
            >
              {/* Orbiting dots */}
              <div className="relative flex items-center justify-center" style={{ width: 140, height: 140 }}>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <motion.div
                    key={i}
                    className="absolute w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: crudColor }}
                    animate={{
                      x: [Math.cos((i / 6) * Math.PI * 2) * 55, Math.cos(((i + 6) / 6) * Math.PI * 2) * 55],
                      y: [Math.sin((i / 6) * Math.PI * 2) * 55, Math.sin(((i + 6) / 6) * Math.PI * 2) * 55],
                      opacity: [0.2, 0.8, 0.2],
                      scale: [0.6, 1.1, 0.6],
                    }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: 'linear', delay: i * 0.15 }}
                  />
                ))}
                <motion.div
                  className="relative z-10 w-16 h-16 rounded-full flex items-center justify-center"
                  style={{ background: crudGradient, boxShadow: `0 8px 32px ${crudColor}40` }}
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <motion.div animate={{ rotate: isDelete ? [0, -10, 10, 0] : 360 }} transition={isDelete ? { duration: 0.5, repeat: Infinity } : { duration: 2, repeat: Infinity, ease: 'linear' }}>
                    <CrudIcon className="w-7 h-7 text-white" />
                  </motion.div>
                </motion.div>
              </div>

              <div className="text-center mt-4">
                <p className="text-[16px] font-bold" style={{ color: crudColor }}>{crudLabel}</p>
                <p className="text-[12px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>{crudSub}</p>
                <div className="w-48 mx-auto mt-3 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: `${crudColor}15` }}>
                  <motion.div className="h-full rounded-full" style={{ backgroundColor: crudColor }} animate={{ x: ['-100%', '100%'] }} transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }} />
                </div>
                <p className="text-[10px] mt-3" style={{ color: 'var(--brand-text-muted)' }}>AI will resume automatically</p>
              </div>
            </motion.div>
          );
        })()}

        {/* ── MAIN VOICE ORB (listening / speaking) ── */}
        {!isConnecting && !isProcessing && !isCheckin && (
          <motion.div
            key="orb"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="relative z-10 flex flex-col items-center"
          >
            {/* Orb container — fixed size, no layout shift */}
            <div className="relative flex items-center justify-center" style={{ width: 170, height: 170 }}>
              {isActive && (
                <>
                  <motion.div className="absolute inset-0 rounded-full" style={{ background: `${orbColor}08` }} animate={{ scale: [1, 1.45, 1], opacity: [0.5, 0, 0.5] }} transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }} />
                  <motion.div className="absolute rounded-full" style={{ inset: 18, background: `${orbColor}10` }} animate={{ scale: [1, 1.25, 1], opacity: [0.6, 0.1, 0.6] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }} />
                  <motion.div className="absolute rounded-full" style={{ inset: 34, background: `${orbColor}18` }} animate={{ scale: [1, 1.12, 1], opacity: [0.8, 0.2, 0.8] }} transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }} />
                </>
              )}
              <motion.div
                className="relative z-10 rounded-full flex items-center justify-center"
                style={{ width: 90, height: 90, background: orbGradient, boxShadow: `0 8px 40px ${orbColor}45` }}
                animate={isActive ? { scale: [1, 1.06, 1] } : { scale: 1 }}
                transition={isActive ? { duration: 1.4, repeat: Infinity, ease: 'easeInOut' } : {}}
              >
                {isSpeaking ? (
                  <div className="flex items-center justify-center gap-[3px]" style={{ height: 32 }}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <motion.div key={i} className="w-[3px] rounded-full bg-white" animate={{ height: [6, 22 + Math.random() * 10, 6] }} transition={{ duration: 0.5 + Math.random() * 0.3, repeat: Infinity, ease: 'easeInOut', delay: i * 0.07 }} />
                    ))}
                  </div>
                ) : isListening ? (
                  <Mic className="w-9 h-9 text-white" />
                ) : (
                  <Mic className="w-8 h-8 text-white opacity-70" />
                )}
              </motion.div>
            </div>

            {/* State text — fixed position below orb */}
            <div className="text-center mt-2">
              <motion.p key={state} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="text-[16px] font-bold" style={{ color: isListening ? '#ef4444' : 'var(--brand-primary-purple)' }}>
                {isListening ? 'Listening' : isSpeaking ? 'AI Speaking' : 'Ready'}
              </motion.p>
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>
                {isListening ? 'Speak naturally...' : isSpeaking ? 'Listening to response...' : ''}
              </p>
            </div>

            {/* Wave bars — fixed height container, no content shift */}
            <div className="flex items-center justify-center gap-[3px] mt-4" style={{ height: 36 }}>
              {isActive && Array.from({ length: 11 }).map((_, i) => (
                <motion.div
                  key={i}
                  className="w-[2.5px] rounded-full"
                  style={{ backgroundColor: `${orbColor}50` }}
                  animate={{ height: [4, 20 + Math.random() * 14, 4] }}
                  transition={{ duration: 0.5 + Math.random() * 0.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.05 }}
                />
              ))}
            </div>

            {/* Emergency notice — always at bottom, fixed position */}
            {isActive && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-2 px-3 py-2 rounded-xl max-w-sm mt-5"
                style={{ backgroundColor: 'var(--brand-alert-red-light)', border: '1px solid rgba(239,68,68,0.15)' }}
              >
                <PhoneCall className="w-3.5 h-3.5 shrink-0" style={{ color: '#ef4444' }} />
                <p className="text-[10px]" style={{ color: '#b91c1c' }}>Chest pain or severe shortness of breath? Call 911 immediately.</p>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Update confirmation — overlays the orb briefly without stopping mic */}
      <AnimatePresence>
        {pendingUpdate && (
          <motion.div
            key="update-confirm"
            initial={{ opacity: 0, scale: 0.92, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 220, damping: 22 }}
            className="absolute z-20 inset-x-0 top-6 flex justify-center pointer-events-none"
          >
            <div
              className="rounded-2xl px-5 py-4 max-w-xs w-full mx-4 pointer-events-auto"
              style={{ backgroundColor: 'white', border: '1.5px solid var(--brand-border)', boxShadow: '0 8px 28px rgba(0,0,0,0.12)' }}
            >
              <div className="flex items-center gap-2 mb-2">
                {pendingUpdate.updated
                  ? <CheckCircle className="w-5 h-5" style={{ color: 'var(--brand-accent-teal)' }} />
                  : <AlertCircle className="w-5 h-5 text-red-500" />}
                <p className="font-bold text-[14px]" style={{ color: 'var(--brand-text-primary)' }}>
                  {pendingUpdate.updated ? 'Reading updated!' : 'Could not update reading'}
                </p>
              </div>
              {pendingUpdate.systolicBP != null && pendingUpdate.diastolicBP != null && (
                <div className="rounded-xl p-2.5 text-center mb-2" style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}>
                  <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--brand-text-muted)' }}>Blood Pressure</p>
                  <p className="text-[18px] font-bold" style={{ color: 'var(--brand-primary-purple)' }}>{pendingUpdate.systolicBP}/{pendingUpdate.diastolicBP} <span className="text-[10px] font-medium">mmHg</span></p>
                </div>
              )}
              <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--brand-border)' }}>
                <motion.div className="h-full rounded-full" style={{ backgroundColor: 'var(--brand-accent-teal)' }} initial={{ width: '100%' }} animate={{ width: '0%' }} transition={{ duration: 3, ease: 'linear' }} />
              </div>
              <p className="text-[10px] mt-1.5 text-center" style={{ color: 'var(--brand-text-muted)' }}>AI will resume talking…</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirmation — same overlay pattern, red accent */}
      <AnimatePresence>
        {pendingDelete && (
          <motion.div
            key="delete-confirm"
            initial={{ opacity: 0, scale: 0.92, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 220, damping: 22 }}
            className="absolute z-20 inset-x-0 top-6 flex justify-center pointer-events-none"
          >
            <div
              className="rounded-2xl px-5 py-4 max-w-xs w-full mx-4 pointer-events-auto"
              style={{ backgroundColor: 'white', border: '1.5px solid var(--brand-border)', boxShadow: '0 8px 28px rgba(0,0,0,0.12)' }}
            >
              <div className="flex items-center gap-2 mb-2">
                {pendingDelete.success
                  ? <CheckCircle className="w-5 h-5" style={{ color: 'var(--brand-alert-red)' }} />
                  : <AlertCircle className="w-5 h-5 text-red-500" />}
                <p className="font-bold text-[14px]" style={{ color: 'var(--brand-text-primary)' }}>
                  {pendingDelete.success
                    ? (pendingDelete.deletedCount === 1 ? 'Reading deleted' : `${pendingDelete.deletedCount} readings deleted`)
                    : 'Could not delete reading'}
                </p>
              </div>
              <div className="rounded-xl p-2.5 text-center mb-2" style={{ backgroundColor: 'var(--brand-alert-red-light)' }}>
                <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--brand-text-muted)' }}>Removed</p>
                <p className="text-[14px] font-bold" style={{ color: 'var(--brand-alert-red)' }}>
                  {pendingDelete.deletedCount} entry{pendingDelete.deletedCount === 1 ? '' : 'ies'}
                  {pendingDelete.failedCount > 0 ? ` (${pendingDelete.failedCount} failed)` : ''}
                </p>
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--brand-border)' }}>
                <motion.div className="h-full rounded-full" style={{ backgroundColor: 'var(--brand-alert-red)' }} initial={{ width: '100%' }} animate={{ width: '0%' }} transition={{ duration: 3, ease: 'linear' }} />
              </div>
              <p className="text-[10px] mt-1.5 text-center" style={{ color: 'var(--brand-text-muted)' }}>AI will resume talking…</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Session mapper helper ────────────────────────────────────────────────────
function mapSessions(arr: Array<{ id: string; title: string; summary?: string | null; updatedAt: string; createdAt: string }>): Session[] {
  return arr.map((s) => {
    const t = (s.title ?? '').toLowerCase();
    const isVoice = t.includes('voice') || t.startsWith('bp check-in');
    const title = s.title || 'Conversation';
    return { id: s.id, title, time: formatSessionTime(s.updatedAt ?? s.createdAt), isVoice, summary: s.summary ?? null };
  });
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AIChatInterface() {
  const { user, token } = useAuth();
  const { t } = useLanguage();
  const searchParams = useSearchParams();

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
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const justCreatedSessionRef = useRef(false);

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
        setSessions(mapSessions(arr));
      })
      .catch(() => {});
  }, []);

  const {
    sessionState: voiceState,
    transcript,
    pendingCheckin: voicePendingCheckin,
    errorMessage: voiceError,
    actionType: voiceActionType,
    prewarmStatus,
    start: startVoice,
    prewarm: prewarmVoice,
    end: endVoice,
    dismissCheckin,
    dismissUpdate,
    dismissDelete,
    clearTranscript,
    pendingUpdate: voicePendingUpdate,
    pendingDelete: voicePendingDelete,
  } = useVoiceSession(handleVoiceSessionCreated);

  // Pre-warm the voice session in the background as soon as we have a token.
  // Opens the WebSocket, builds patient context, and establishes the Gemini
  // Live connection while the user is still reading the UI — so the first mic
  // click has no setup delay. Only runs once per AIChatInterface mount per token.
  const prewarmedOnceRef = useRef(false);
  useEffect(() => {
    if (!token || prewarmedOnceRef.current) return;
    prewarmedOnceRef.current = true;
    // Fire-and-forget, but catch so an unhandled rejection doesn't surface
    // as a console warning. The hook tracks state via prewarmStatus; this
    // .catch() just silences the promise, not the error signal.
    Promise.resolve(prewarmVoice({ token, sessionId: activeSessionId ?? undefined }))
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[voice prewarm] fire-and-forget rejected:', err);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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
      voiceDebug('AIChat', `voicePendingUpdate mirrored entryId=${voicePendingUpdate.entryId}`);
      setPendingUpdateCard(voicePendingUpdate);
    }
  }, [voicePendingUpdate]);

  useEffect(() => {
    if (voicePendingCheckin) {
      voiceDebug('AIChat', `voicePendingCheckin mirrored saved=${voicePendingCheckin.saved}`);
    }
  }, [voicePendingCheckin]);

  useEffect(() => {
    if (voicePendingDelete) {
      voiceDebug('AIChat', `voicePendingDelete observed deleted=${voicePendingDelete.deletedCount} failed=${voicePendingDelete.failedCount}`);
    }
  }, [voicePendingDelete]);

  // When voice session ends, convert the live transcript lines into permanent messages
  // (keeps the full conversation visible instead of replacing with DB summaries)
  const [voiceSummaryLoading, setVoiceSummaryLoading] = useState(false);

  const prevVoiceStateRef = useRef(voiceState);
  useEffect(() => {
    const prev = prevVoiceStateRef.current;
    prevVoiceStateRef.current = voiceState;
    if (prev !== 'idle' && voiceState === 'idle') {
      voiceDebug('AIChat', `idle transition from=${prev} — tearing down voice session and loading summary`);
      // Clear everything immediately — show skeleton
      clearTranscript();
      setMessages([]);
      setPendingCheckin(null);
      setPendingUpdateCard(null);
      setVoiceSummaryLoading(true);

      const sessionId = activeSessionId;

      const loadVoiceSummary = async () => {
        if (!sessionId) return;

        // Poll the single session endpoint until summary is ready
        const maxAttempts = 8;
        const delayMs = 2500;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, delayMs));

          try {
            const session = await getSessionApi(sessionId);

            if (session.summary) {
              // Summary is ready — show it
              setMessages([{
                id: Date.now(),
                type: 'ai' as MessageType,
                source: 'voice' as MessageSource,
                text: session.summary,
                time: nowTimeStr(),
              }]);

              // Also refresh sidebar with updated title + summary
              getChatSessions().then((data) => {
                setSessions(mapSessions(Array.isArray(data) ? data : []));
              }).catch(() => {});

              return;
            }
          } catch {
            // continue retrying
          }
        }

        // All retries exhausted — fallback to conversation history
        try {
          const history = await getSessionHistory(sessionId);
          const hArr = Array.isArray(history) ? history : [];
          const combined = hArr.map((item: { aiSummary: string }) => item.aiSummary).filter(Boolean).join('\n\n');
          if (combined) {
            setMessages([{ id: 0, type: 'ai' as MessageType, source: 'voice' as MessageSource, text: combined, time: nowTimeStr() }]);
          }
        } catch {
          setMessages([]);
        }

        // Refresh sidebar anyway
        getChatSessions().then((data) => {
          setSessions(mapSessions(Array.isArray(data) ? data : []));
        }).catch(() => {});
      };

      loadVoiceSummary().finally(() => setVoiceSummaryLoading(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState]);

  // ── Scroll ────────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, transcript]);

  // ── Pre-fill input from query param (e.g. /chat?q=My%20BP%20readings) ────
  const qParamHandled = useRef(false);
  useEffect(() => {
    if (qParamHandled.current) return;
    const q = searchParams?.get('q');
    if (q) {
      setInputValue(q);
      qParamHandled.current = true;
    }
  }, [searchParams]);

  // ── Load sessions ─────────────────────────────────────────────────────────
  useEffect(() => {
    setIsLoadingSessions(true);
    getChatSessions()
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        setSessions(mapSessions(arr));
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
    // Skip history fetch when we just created this session in handleSend —
    // messages are already in state and the backend hasn't persisted them yet.
    if (justCreatedSessionRef.current) {
      justCreatedSessionRef.current = false;
      return;
    }
    setIsLoadingHistory(true);
    setMessages([]);
    const currentSession = sessions.find((s) => s.id === activeSessionId);
    const isVoiceSession = currentSession?.isVoice ?? false;

    if (isVoiceSession && currentSession?.summary) {
      // Voice sessions: show the rolling session summary directly
      setMessages([{
        id: Date.now(),
        type: 'ai' as MessageType,
        source: 'voice' as MessageSource,
        text: currentSession.summary!,
        time: currentSession.time,
      }]);
      setIsLoadingHistory(false);
    } else {
      getSessionHistory(activeSessionId)
        .then((history) => {
          const arr = Array.isArray(history) ? history : [];
          const msgs: Message[] = [];

          if (isVoiceSession) {
            // Voice session without summary yet — show combined aiSummary as one block
            const combined = arr
              .map((item: { aiSummary: string }) => item.aiSummary)
              .filter(Boolean)
              .join('\n\n');
            if (combined) {
              msgs.push({ id: 0, type: 'ai', source: 'voice', text: combined, time: formatMsgTime(arr[0]?.timestamp ?? '') });
            }
          } else {
            // Text sessions: show full back-and-forth
            arr.forEach((item: { id: string; userMessage: string; aiSummary: string; source: string; timestamp: string }, idx: number) => {
              msgs.push({ id: idx * 2, type: 'patient', source: (item.source as MessageSource) || 'text', text: item.userMessage, time: formatMsgTime(item.timestamp) });
              msgs.push({ id: idx * 2 + 1, type: 'ai', source: (item.source as MessageSource) || 'text', text: item.aiSummary, time: formatMsgTime(item.timestamp) });
            });
          }

          setMessages(msgs);
        })
        .catch(() => setMessages([]))
        .finally(() => setIsLoadingHistory(false));
    }
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
        justCreatedSessionRef.current = true;
        setActiveSessionId(response.sessionId);
        getChatSessions()
          .then((data) => {
            const arr = Array.isArray(data) ? data : [];
            setSessions(mapSessions(arr));
          })
          .catch(() => {});
      }

      // Only add AI message if there's actual text content
      if (response.data && response.data.trim()) {
        setMessages((prev) => [
          ...prev,
          { id: Date.now() + 1, type: response.isEmergency ? 'teachback' : 'ai', source: 'text', text: response.data, time: nowTimeStr() },
        ]);
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
    setPendingCheckin(null);
    setPendingUpdateCard(null);
  };

  const handleRequestDelete = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (session) setDeleteTarget(session);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteSessionApi(deleteTarget.id);
      setSessions((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      if (activeSessionId === deleteTarget.id) {
        setActiveSessionId(null);
        setMessages([]);
      }
    } catch {
      // best-effort
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleSelectSession = (id: string) => {
    setActiveSessionId(id);
    setShowSessions(false);
    setPendingCheckin(null);
    setPendingUpdateCard(null);
  };

  const handleMicClick = async () => {
    if (isVoiceActive || isVoiceConnecting) {
      await endVoice();
    } else if (token) {
      await startVoice({ token });
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
          onNewConversation={handleNewConversation} onDeleteSession={handleRequestDelete} userInitials={userInitials}
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
                onNewConversation={handleNewConversation} onDeleteSession={handleRequestDelete} userInitials={userInitials}
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
              <Image src="/logo.svg" alt="Cardioplace" width={30} height={30} />
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

        {/* Messages area / Voice active screen */}
        {voiceState !== 'idle' && voiceState !== 'error' ? (
          <VoiceActiveScreen
            state={voiceState}
            pendingCheckin={pendingCheckin}
            onDismissCheckin={handleDismissCheckin}
            pendingUpdate={voicePendingUpdate}
            onDismissUpdate={dismissUpdate}
            pendingDelete={voicePendingDelete}
            onDismissDelete={dismissDelete}
            actionType={voiceActionType}
          />
        ) : (
        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5 space-y-4 min-h-0" style={{ backgroundColor: 'var(--brand-background)' }}>
          {isLoadingHistory && (
            <div className="space-y-4 py-4">
              <div className="flex justify-end"><div className="animate-pulse rounded-2xl px-4 py-3" style={{ backgroundColor: 'var(--brand-primary-purple-light)', width: '65%' }}><div className="h-3 rounded-full mb-2" style={{ backgroundColor: '#E9D5FF', width: '80%', marginLeft: 'auto' }} /><div className="h-3 rounded-full" style={{ backgroundColor: '#E9D5FF', width: '50%', marginLeft: 'auto' }} /></div></div>
              <div className="flex justify-start"><div className="animate-pulse rounded-2xl px-4 py-3 bg-white" style={{ width: '75%' }}><div className="h-3 rounded-full mb-2" style={{ backgroundColor: '#EDE9F6', width: '90%' }} /><div className="h-3 rounded-full" style={{ backgroundColor: '#EDE9F6', width: '60%' }} /></div></div>
            </div>
          )}

          {messages.length === 0 && transcript.length === 0 && !isTyping && !isLoadingHistory && !voiceSummaryLoading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-xs mx-auto">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'linear-gradient(135deg, #7b00e017, #9233ea43)', boxShadow: '0 8px 28px rgba(123, 0, 224, 0.14)' }}>
                  <Image src="/logo.svg" alt="Cardioplace" width={50} height={50} />
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

          {/* Voice summary loading skeleton */}
          {voiceSummaryLoading && (
            <div className="space-y-3 py-4 animate-pulse">
              <div className="flex justify-start">
                <div className="rounded-2xl px-4 py-3 bg-white" style={{ width: '80%', boxShadow: '0 1px 8px rgba(123,0,224,0.06)' }}>
                  <div className="h-3 rounded-full mb-2" style={{ backgroundColor: '#EDE9F6', width: '95%' }} />
                  <div className="h-3 rounded-full mb-2" style={{ backgroundColor: '#EDE9F6', width: '75%' }} />
                  <div className="h-3 rounded-full mb-2" style={{ backgroundColor: '#EDE9F6', width: '85%' }} />
                  <div className="h-3 rounded-full" style={{ backgroundColor: '#EDE9F6', width: '50%' }} />
                </div>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}

          {/* Check-in result card — only for text mode, not voice */}
          {voiceState === 'idle' && !voiceSummaryLoading && (
            <>
              <AnimatePresence>
                {pendingCheckin && (
                  <motion.div key="checkin" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <CheckinCard summary={pendingCheckin} onDismiss={handleDismissCheckin} />
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {pendingUpdateCard && (
                  <motion.div key="update" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <UpdateCard summary={pendingUpdateCard} onDismiss={() => { setPendingUpdateCard(null); dismissUpdate(); }} />
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}

          <AnimatePresence>
            {isTyping && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
                <TypingIndicator />
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>
        )}

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

            {/* Mic button — disabled while text is sending. Color encodes:
                - red: active call
                - amber: connecting (in flight)
                - amber-outline + warning title: prewarm failed, click to retry
                - purple: idle / ready */}
            <motion.button
              onClick={() => void handleMicClick()}
              disabled={!token || isSending}
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition disabled:opacity-40"
              style={{
                background: isVoiceActive
                  ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                  : isVoiceConnecting
                  ? '#f59e0b'
                  : prewarmStatus === 'failed'
                  ? '#fef3c7'
                  : 'var(--brand-primary-purple-light)',
                outline: prewarmStatus === 'failed' ? '1px solid #d97706' : 'none',
                outlineOffset: prewarmStatus === 'failed' ? '-1px' : undefined,
              }}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              title={
                isVoiceActive
                  ? t('chat.endVoice')
                  : prewarmStatus === 'failed'
                  ? 'Voice is temporarily unavailable — click to retry'
                  : t('chat.startVoice')
              }
            >
              {isVoiceActive
                ? <MicOff className="w-3.5 h-3.5 text-white" />
                : <Mic
                    className="w-3.5 h-3.5"
                    style={{
                      color: isVoiceConnecting
                        ? 'white'
                        : prewarmStatus === 'failed'
                        ? '#d97706'
                        : 'var(--brand-primary-purple)',
                    }}
                  />
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

      {/* Delete confirm modal */}
      <AnimatePresence>
        {deleteTarget && (
          <DeleteConfirmModal
            sessionTitle={deleteTarget.title}
            onConfirm={handleConfirmDelete}
            onCancel={() => setDeleteTarget(null)}
            deleting={isDeleting}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
