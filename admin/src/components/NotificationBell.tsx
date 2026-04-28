'use client';

// Top-bar notification bell with badge + dropdown.
//
// Polls the unread count every 30s for the badge — short enough to feel
// near-real-time for a clinical workflow, long enough to stay cheap.
// Clicking the bell opens a dropdown with the 10 most-recent notifications
// (any channel except EMAIL); clicking "View all" jumps to the full
// /admin/notifications page (which is also where the dashboard's
// "Action required → View all" link lands — single shared inbox).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Loader2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/services/token';
import {
  getAdminNotifications,
  markAdminNotificationRead,
  type AdminNotificationDto,
} from '@/lib/services/provider.service';

const POLL_INTERVAL_MS = 30_000;
const DROPDOWN_LIMIT = 10;
const API = process.env.NEXT_PUBLIC_API_URL;

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export default function NotificationBell() {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AdminNotificationDto[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);

  const refreshCount = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${API}/api/daily-journal/notifications/unread-count`);
      if (!res.ok) return;
      const json = await res.json();
      const next = Number(json?.data?.unread ?? 0);
      if (mountedRef.current && Number.isFinite(next)) setCount(next);
    } catch {
      // Silent — bell shouldn't surface network noise. Next tick retries.
    }
  }, []);

  const refreshItems = useCallback(async () => {
    setItemsLoading(true);
    try {
      const data = await getAdminNotifications({ limit: DROPDOWN_LIMIT });
      if (mountedRef.current) setItems(data);
    } finally {
      if (mountedRef.current) setItemsLoading(false);
    }
  }, []);

  // Poll the unread count regardless of dropdown state — the badge must
  // stay current so the user knows something arrived without opening.
  useEffect(() => {
    mountedRef.current = true;
    void refreshCount();
    const id = setInterval(() => void refreshCount(), POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refreshCount]);

  // Close the dropdown on outside click. Pointerdown beats click so
  // clicking another button doesn't get swallowed by a closing overlay.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  // Lazy-load the list on first open + every subsequent open so the user
  // always sees fresh items without paying the cost on every tab.
  function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next) void refreshItems();
  }

  async function handleItemClick(n: AdminNotificationDto) {
    if (!n.watched) {
      await markAdminNotificationRead(n.id).catch(() => null);
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, watched: true } : x)));
      // Optimistically decrement the badge so the user sees instant feedback.
      setCount((prev) => Math.max(0, prev - 1));
    }
    setOpen(false);
    if (n.alertId) router.push(`/notifications`);
  }

  function handleViewAll() {
    setOpen(false);
    router.push('/notifications');
  }

  const display = count > 9 ? '9+' : String(count);
  const hasUnread = count > 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer transition-colors relative"
        style={{ color: 'var(--brand-text-secondary)' }}
        aria-label={hasUnread ? `Notifications — ${count} unread` : 'Notifications — none unread'}
        aria-expanded={open}
        title={hasUnread ? `${count} unread` : 'No unread notifications'}
      >
        <Bell className="w-4 h-4" />
        {hasUnread && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center"
            style={{ backgroundColor: 'var(--brand-alert-red)' }}
            aria-hidden
          >
            {display}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl bg-white z-50 overflow-hidden"
          style={{
            boxShadow: '0 10px 40px rgba(0,0,0,0.12)',
            border: '1px solid var(--brand-border)',
          }}
          role="dialog"
          aria-label="Notifications"
        >
          {/* Header */}
          <div
            className="px-4 py-2.5 flex items-center justify-between"
            style={{ borderBottom: '1px solid var(--brand-border)' }}
          >
            <p className="text-[12px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
              Notifications
            </p>
            {hasUnread && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'var(--brand-alert-red-light)',
                  color: 'var(--brand-alert-red)',
                }}
              >
                {count} unread
              </span>
            )}
          </div>

          {/* Body */}
          <div className="max-h-[60vh] overflow-y-auto">
            {itemsLoading && items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Loader2 className="w-4 h-4 mx-auto animate-spin" style={{ color: 'var(--brand-text-muted)' }} />
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--brand-text-muted)' }} />
                <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
                  No notifications yet
                </p>
              </div>
            ) : (
              items.map((n, idx) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleItemClick(n)}
                  className="w-full text-left px-4 py-2.5 flex items-start gap-2.5 transition-colors hover:bg-gray-50 cursor-pointer"
                  style={{ borderTop: idx > 0 ? '1px solid var(--brand-border)' : 'none' }}
                >
                  <span
                    className="shrink-0 w-2 h-2 rounded-full mt-1.5"
                    style={{
                      backgroundColor: n.watched ? 'var(--brand-border)' : 'var(--brand-primary-purple)',
                    }}
                    aria-hidden
                  />
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-[12px] leading-tight truncate"
                      style={{
                        color: 'var(--brand-text-primary)',
                        fontWeight: n.watched ? 500 : 700,
                      }}
                    >
                      {n.title}
                    </p>
                    {n.body && (
                      <p
                        className="text-[11px] mt-0.5 leading-snug line-clamp-2"
                        style={{ color: 'var(--brand-text-secondary)' }}
                      >
                        {n.body}
                      </p>
                    )}
                    <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>
                      {timeAgo(n.sentAt)}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Footer — always present so the affordance is consistent */}
          <button
            type="button"
            onClick={handleViewAll}
            className="w-full px-4 py-2.5 text-[12px] font-bold text-center cursor-pointer transition-colors hover:bg-gray-50"
            style={{
              borderTop: '1px solid var(--brand-border)',
              color: 'var(--brand-primary-purple)',
            }}
          >
            View all →
          </button>
        </div>
      )}
    </div>
  );
}
