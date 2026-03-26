'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Mic,
  Paperclip,
  Plus,
  Volume2,
  ArrowRight,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  sendMessage as sendChatMessage,
  getChatSessions,
  getSessionHistory,
} from '@/lib/services/chat.service';

// ─── Types ────────────────────────────────────────────────────────────────────
type MessageType = 'ai' | 'patient' | 'teachback';

interface Message {
  id: number;
  type: MessageType;
  text: string;
  time: string;
}

interface Session {
  id: string;
  title: string;
  time: string;
  active: boolean;
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

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function SessionSkeleton() {
  return (
    <div className="space-y-1 px-1">
      {[75, 60, 80, 50].map((w, i) => (
        <div key={i} className="animate-pulse px-3 py-3 rounded-xl">
          <div
            className="h-3 rounded-full mb-2"
            style={{ backgroundColor: '#EDE9F6', width: `${w}%` }}
          />
          <div
            className="h-2 rounded-full"
            style={{ backgroundColor: '#EDE9F6', width: '42%' }}
          />
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
        style={{
          background: 'linear-gradient(135deg, #7b00e017, #9233ea43)',
          boxShadow: '0 2px 8px rgba(123,0,224,0.3)',
        }}
      >
        <Image src="/logo.svg" alt="Healplace" width={30} height={30} />
      </div>
      <div
        className="flex items-center gap-1.5 px-4 py-3.5"
        style={{
          backgroundColor: 'white',
          borderRadius: '4px 18px 18px 18px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
        }}
      >
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: 'var(--brand-primary-purple)' }}
            animate={{ y: [0, -5, 0] }}
            transition={{
              duration: 0.8,
              repeat: Infinity,
              delay: i * 0.15,
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: Message }) {
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
          <p
            className="text-[10px] mt-1.5 text-right"
            style={{ color: 'rgba(255,255,255,0.6)' }}
          >
            {msg.time}
          </p>
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
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg, #7b00e017, #9233ea43)',}}
        >
          <Image src="/logo.svg" alt="Healplace" width={30} height={30} />
        </div>
        <div
          className="max-w-[75%] sm:max-w-[65%] px-4 py-3.5"
          style={{
            backgroundColor: 'var(--brand-accent-teal-light)',
            borderRadius: '4px 18px 18px 18px',
            borderLeft: '3px solid var(--brand-accent-teal)',
          }}
        >
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold mb-2"
            style={{ backgroundColor: 'var(--brand-accent-teal)', color: 'white' }}
          >
            Comprehension Check
          </span>
          <p
            className="text-[14px] leading-relaxed"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            {msg.text}
          </p>
          <p
            className="text-[10px] mt-1.5 text-right"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            {msg.time}
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="flex items-end gap-2.5"
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2 }}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{
          background: 'linear-gradient(135deg, #7b00e017, #9233ea43)',
                    boxShadow: '0 8px 28px rgba(123, 0, 224, 0.14)',
        }}
      >
        <Image src="/logo.svg" alt="Healplace" width={30} height={30} />
      </div>
      <div
        className="max-w-[75%] sm:max-w-[65%] px-4 py-3.5"
        style={{
          backgroundColor: 'white',
          borderRadius: '4px 18px 18px 18px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
        }}
      >
        <p
          className="text-[14px] leading-relaxed"
          style={{ color: 'var(--brand-text-primary)' }}
        >
          {msg.text}
        </p>
        <p
          className="text-[10px] mt-1.5 text-right"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          {msg.time}
        </p>
      </div>
    </motion.div>
  );
}

// ─── Sidebar content (shared desktop + mobile drawer) ─────────────────────────
function SidebarContent({
  sessions,
  activeId,
  onSelect,
  onNewConversation,
  userInitials,
  userName,
  riskTier,
  isLoading,
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
  const riskColor =
    riskTier === 'HIGH'
      ? { bg: 'var(--brand-alert-red-light)', text: 'var(--brand-alert-red)' }
      : riskTier === 'ELEVATED'
      ? { bg: 'var(--brand-warning-amber-light)', text: 'var(--brand-warning-amber)' }
      : { bg: 'var(--brand-success-green-light)', text: 'var(--brand-success-green)' };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header + New Chat button */}
      <div className="px-4 pt-5 pb-3 shrink-0">
        <h2
          className="text-[15px] font-bold mb-3"
          style={{ color: 'var(--brand-text-primary)' }}
        >
          Conversations
        </h2>

        {/* New Conversation — prominent gradient button */}
        <button
          onClick={onNewConversation}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
          style={{
            background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
            color: 'white',
            boxShadow: '0 4px 14px rgba(123,0,224,0.28)',
          }}
        >
          <Plus className="w-4 h-4" />
          New Conversation
        </button>
      </div>

      {/* User profile card */}
      <div className="px-4 pb-3 shrink-0">
        <div
          className="rounded-2xl p-3.5"
          style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[12px] font-bold shrink-0"
              style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
            >
              {userInitials}
            </div>
            <div className="flex-1 min-w-0">
              <p
                className="text-[13px] font-bold truncate"
                style={{ color: 'var(--brand-text-primary)' }}
              >
                {userName}
              </p>
              <p
                className="text-[11px] font-medium"
                style={{ color: 'var(--brand-accent-teal)' }}
              >
                Patient
              </p>
            </div>
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0"
              style={{ backgroundColor: riskColor.bg, color: riskColor.text }}
            >
              {riskTier}
            </span>
          </div>
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-3 pb-4 min-h-0">
        <p
          className="text-[10px] font-bold uppercase tracking-wider px-2 mb-2"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          Recent
        </p>

        {isLoading ? (
          <SessionSkeleton />
        ) : sessions.length === 0 ? (
          <p
            className="text-[12px] px-2 py-2"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            No conversations yet — start one above!
          </p>
        ) : (
          <div className="space-y-0.5">
            {sessions.map((s) => {
              const isActive = s.id === activeId;
              return (
                <button
                  key={s.id}
                  onClick={() => onSelect(s.id)}
                  className="w-full text-left px-3 py-2.5 rounded-xl transition-all"
                  style={{
                    backgroundColor: isActive
                      ? 'var(--brand-primary-purple-light)'
                      : 'transparent',
                    borderLeft: isActive
                      ? '2px solid var(--brand-primary-purple)'
                      : '2px solid transparent',
                  }}
                >
                  <p
                    className="text-[13px] font-semibold truncate"
                    style={{
                      color: isActive
                        ? 'var(--brand-primary-purple)'
                        : 'var(--brand-text-secondary)',
                    }}
                  >
                    {s.title}
                  </p>
                  <p
                    className="text-[11px] mt-0.5 truncate"
                    style={{ color: 'var(--brand-text-muted)' }}
                  >
                    {s.time}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AIChatInterface() {
  const { user } = useAuth();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const userInitials = getUserInitials(user?.name);
  const userName = user?.name ?? 'Patient';
  const riskTier = user?.riskTier ?? 'STANDARD';

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Load sessions on mount
  useEffect(() => {
    setIsLoadingSessions(true);
    getChatSessions()
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        const mapped: Session[] = arr.map(
          (s: { id: string; title: string; updatedAt: string; createdAt: string }) => ({
            id: s.id,
            title: s.title || 'Conversation',
            time: formatSessionTime(s.updatedAt ?? s.createdAt),
            active: false,
          }),
        );
        setSessions(mapped);
        if (mapped.length > 0 && !activeSessionId) {
          setActiveSessionId(mapped[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoadingSessions(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load history when active session changes
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }
    getSessionHistory(activeSessionId)
      .then((history) => {
        const arr = Array.isArray(history) ? history : [];
        const msgs: Message[] = [];
        arr.forEach(
          (
            item: { id: string; userMessage: string; aiResponse: string; timestamp: string },
            idx: number,
          ) => {
            msgs.push({
              id: idx * 2,
              type: 'patient',
              text: item.userMessage,
              time: formatMsgTime(item.timestamp),
            });
            msgs.push({
              id: idx * 2 + 1,
              type: 'ai',
              text: item.aiResponse,
              time: formatMsgTime(item.timestamp),
            });
          },
        );
        setMessages(msgs);
      })
      .catch(() => setMessages([]));
  }, [activeSessionId]);

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || isSending) return;

    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const userMsg: Message = { id: Date.now(), type: 'patient', text, time: timeStr };
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
            setSessions(
              arr.map(
                (s: { id: string; title: string; updatedAt: string; createdAt: string }) => ({
                  id: s.id,
                  title: s.title || 'Conversation',
                  time: formatSessionTime(s.updatedAt ?? s.createdAt),
                  active: false,
                }),
              ),
            );
          })
          .catch(() => {});
      }

      const aiMsg: Message = {
        id: Date.now() + 1,
        type: response.isEmergency ? 'teachback' : 'ai',
        text: response.data,
        time: new Date().toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        }),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch {
      setIsTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          type: 'ai',
          text: 'Sorry, I had trouble connecting. Please try again.',
          time: new Date().toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          }),
        },
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

  return (
    <div
      className="flex"
      style={{
        height: 'calc(100vh - 4rem)',
        backgroundColor: 'var(--brand-background)',
      }}
    >
      {/* ── Desktop Sidebar ────────────────────────────────────────────── */}
      <div
        className="hidden lg:flex flex-col w-72 shrink-0 h-full"
        style={{
          backgroundColor: 'white',
          borderRight: '1px solid var(--brand-border)',
        }}
      >
        <SidebarContent
          sessions={sessions}
          activeId={activeSessionId}
          onSelect={handleSelectSession}
          onNewConversation={handleNewConversation}
          userInitials={userInitials}
          userName={userName}
          riskTier={riskTier}
          isLoading={isLoadingSessions}
        />
      </div>

      {/* ── Mobile Sessions Drawer ────────────────────────────────────── */}
      <AnimatePresence>
        {showSessions && (
          <>
            <motion.div
              className="lg:hidden fixed inset-0 z-40 bg-black/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSessions(false)}
            />
            <motion.div
              className="lg:hidden fixed top-16 left-0 bottom-0 z-50 w-72 flex flex-col"
              style={{
                backgroundColor: 'white',
                boxShadow: '4px 0 24px rgba(0,0,0,0.14)',
              }}
              initial={{ x: -288 }}
              animate={{ x: 0 }}
              exit={{ x: -288 }}
              transition={{ type: 'spring', stiffness: 360, damping: 34 }}
            >
              {/* Close button */}
              <button
                onClick={() => setShowSessions(false)}
                className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center z-10 transition hover:bg-gray-100"
                style={{ backgroundColor: 'var(--brand-background)' }}
              >
                <X className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
              </button>

              <SidebarContent
                sessions={sessions}
                activeId={activeSessionId}
                onSelect={handleSelectSession}
                onNewConversation={handleNewConversation}
                userInitials={userInitials}
                userName={userName}
                riskTier={riskTier}
                isLoading={isLoadingSessions}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Chat area ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Chat header */}
        <div
          className="bg-white flex items-center gap-3 px-4 lg:px-6 py-3.5 shrink-0"
          style={{
            borderBottom: '1px solid var(--brand-border)',
            boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
          }}
        >
          {/* Mobile: sessions toggle */}
          <button
            className="lg:hidden p-1.5 rounded-lg transition hover:bg-gray-50 shrink-0"
            onClick={() => setShowSessions(true)}
            aria-label="Open sessions"
          >
            <Menu className="w-5 h-5" style={{ color: 'var(--brand-text-muted)' }} />
          </button>

          {/* AI identity */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
              style={{
                background: 'linear-gradient(135deg, #7b00e017, #9233ea43)',
                    boxShadow: '0 8px 28px rgba(123, 0, 224, 0.14)',
              }}
            >
              <Image src="/logo.svg" alt="Healplace" width={30} height={30}/>
            </div>
            <div>
              <p
                className="text-[14px] font-semibold leading-tight"
                style={{ color: 'var(--brand-text-primary)' }}
              >
                Healplace Cardio AI
              </p>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                <span className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
                  Online · Monitored by care team
                </span>
              </div>
            </div>
          </div>

          {/* Right: context badge + mobile new chat button */}
          <div className="flex items-center gap-2 shrink-0">
            <span
              className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold"
              style={{
                backgroundColor: 'var(--brand-accent-teal-light)',
                color: 'var(--brand-accent-teal)',
              }}
            >
              Context loaded
            </span>
            <button
              className="lg:hidden w-8 h-8 rounded-full flex items-center justify-center transition hover:opacity-85 active:scale-95"
              style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
              onClick={handleNewConversation}
              aria-label="New conversation"
            >
              <Plus className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>

        {/* Messages area */}
        <div
          className="flex-1 overflow-y-auto px-4 md:px-6 py-5 space-y-4 min-h-0"
          style={{ backgroundColor: 'var(--brand-background)' }}
        >
          {messages.length === 0 && !isTyping && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-xs mx-auto">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                  style={{
                    background: 'linear-gradient(135deg, #7b00e017, #9233ea43)',
                    boxShadow: '0 8px 28px rgba(123, 0, 224, 0.14)',
                  }}
                >
                  <Image src="/logo.svg" alt="Healplace" width={50} height={50} />
                </div>
                <p
                  className="text-[16px] font-bold mb-1.5"
                  style={{ color: 'var(--brand-text-primary)' }}
                >
                  How can I help you today?
                </p>
                <p
                  className="text-[13px] leading-relaxed"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  Ask me about your blood pressure, medications, or how you&apos;re feeling.
                </p>
                {/* Suggestion chips */}
                <div className="flex flex-wrap gap-2 justify-center mt-5">
                  {['My BP readings', 'Medication tips', 'How am I doing?'].map((chip) => (
                    <button
                      key={chip}
                      onClick={() => setInputValue(chip)}
                      className="px-3 py-1.5 rounded-full text-[12px] font-semibold transition hover:opacity-80 active:scale-95"
                      style={{
                        backgroundColor: 'var(--brand-primary-purple-light)',
                        color: 'var(--brand-primary-purple)',
                        border: '1px solid #E9D5FF',
                      }}
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

          <AnimatePresence>
            {isTyping && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
              >
                <TypingIndicator />
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>

        {/* Audio mode banner */}
        <div
          className="shrink-0 flex items-center justify-between px-4 lg:px-6 py-2"
          style={{
            backgroundColor: '#FAF5FF',
            borderTop: '1px solid var(--brand-border)',
            borderBottom: '1px solid var(--brand-border)',
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Volume2
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: 'var(--brand-primary-purple)' }}
            />
            <span className="text-[12px]" style={{ color: 'var(--brand-text-secondary)' }}>
              Audio mode available
            </span>
            <span
              className="hidden sm:inline text-[12px]"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              · Tap the mic to speak
            </span>
          </div>
          <button
            className="shrink-0 flex items-center gap-1 text-[12px] font-semibold ml-3 transition hover:opacity-70"
            style={{ color: 'var(--brand-primary-purple)' }}
          >
            Switch
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        {/* Input bar */}
        <div
          className="shrink-0 bg-white px-4 lg:px-6 pt-3 pb-4"
          style={{ borderTop: '1px solid var(--brand-border)' }}
        >
          <div
            className="flex items-center gap-2 px-4 py-1.5 transition-all"
            style={{
              border: '1.5px solid var(--brand-border)',
              borderRadius: '28px',
              backgroundColor: 'var(--brand-background)',
            }}
          >
            <button className="shrink-0 p-1 transition hover:opacity-70">
              <Paperclip className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
            </button>

            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              className="flex-1 bg-transparent text-[14px] outline-none min-w-0 py-2"
              style={{ color: 'var(--brand-text-primary)' }}
              disabled={isSending}
            />

            <button className="shrink-0 p-1 transition hover:opacity-70">
              <Mic className="w-4 h-4" style={{ color: 'var(--brand-primary-purple)' }} />
            </button>

            <motion.button
              onClick={() => void handleSend()}
              disabled={isSending || !inputValue.trim()}
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 disabled:opacity-40"
              style={{
                background: inputValue.trim()
                  ? 'linear-gradient(135deg, #7B00E0, #9333EA)'
                  : 'var(--brand-border)',
                boxShadow: inputValue.trim()
                  ? '0 4px 14px rgba(123,0,224,0.35)'
                  : 'none',
                transition: 'background 0.2s, box-shadow 0.2s',
              }}
              whileHover={inputValue.trim() ? { scale: 1.08 } : {}}
              whileTap={inputValue.trim() ? { scale: 0.92 } : {}}
            >
              <Send className="w-3.5 h-3.5 text-white" />
            </motion.button>
          </div>

          <p
            className="text-center text-[10px] mt-2"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            Healplace Cardio AI &middot; Responses monitored by care team
          </p>
        </div>
      </div>
    </div>
  );
}
