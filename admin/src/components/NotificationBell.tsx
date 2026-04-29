'use client';

// Top-bar notification bell with badge + dropdown.
//
// Badge shows the SUM of (open clinical alerts) + (unread notifications) so
// the admin sees a single "things to deal with" number — same pattern as
// the patient-app navbar bell. A 30s silent poll keeps the count current
// without a visible refresh; mutations on /notifications (acknowledge,
// resolve, mark-read) broadcast a window event so the bell refetches on
// the same tick instead of waiting for the next poll. Mutations from
// inside this dropdown re-broadcast so any open /notifications page
// updates in lockstep.
//
// Clicking the bell opens a dropdown with the 10 most-recent notifications
// (any channel except EMAIL). Each unread row exposes a "✓" pill so the
// admin can dismiss without navigating away; the header carries a
// "Mark all read" action that hits the bulk endpoint. "View all" jumps
// to the full /admin/notifications page (which is also where the dashboard's
// "Action required → View all" link lands — single shared inbox).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check, CheckCheck, Loader2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/services/token';
import {
  getAdminNotifications,
  getProviderAlerts,
  markAdminNotificationRead,
  markAdminNotificationsReadBulk,
  type AdminNotificationDto,
} from '@/lib/services/provider.service';

const POLL_INTERVAL_MS = 30_000;
const DROPDOWN_LIMIT = 10;
const API = process.env.NEXT_PUBLIC_API_URL;
const NOTIF_CHANGE_EVENT = 'cardio:notifications-changed';

function broadcastChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(NOTIF_CHANGE_EVENT));
  }
}

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
  const [markingAll, setMarkingAll] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);

  // Combined badge = open alerts + unread notifications. Two parallel
  // fetches: the lightweight unread-count endpoint plus the alerts list
  // (which the provider endpoint already filters to status=OPEN). State
  // only updates when the value actually changes so React skips no-op
  // re-renders — no visible blink while the user is mid-page.
  const refreshCount = useCallback(async () => {
    try {
      const [alertData, unreadJson] = await Promise.all([
        getProviderAlerts().catch(() => [] as unknown[]),
        fetchWithAuth(`${API}/api/daily-journal/notifications/unread-count`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      if (!mountedRef.current) return;
      const openAlertCount = Array.isArray(alertData) ? alertData.length : 0;
      const unreadNotifCount = Number(unreadJson?.data?.unread ?? 0);
      const next = openAlertCount + (Number.isFinite(unreadNotifCount) ? unreadNotifCount : 0);
      setCount((prev) => (prev === next ? prev : next));
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

  // Poll the badge regardless of dropdown state — must stay current so the
  // admin knows something arrived without opening. Also listen for the
  // window-level change event so /notifications mutations refresh us on
  // the same tick (no 30s lag) and re-fetch the dropdown items if open
  // (otherwise the items list goes stale while the badge updates).
  useEffect(() => {
    mountedRef.current = true;
    void refreshCount();
    const id = setInterval(() => void refreshCount(), POLL_INTERVAL_MS);
    const onChange = () => {
      void refreshCount();
      if (open) void refreshItems();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener(NOTIF_CHANGE_EVENT, onChange);
    }
    return () => {
      mountedRef.current = false;
      clearInterval(id);
      if (typeof window !== 'undefined') {
        window.removeEventListener(NOTIF_CHANGE_EVENT, onChange);
      }
    };
  }, [refreshCount, refreshItems, open]);

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

  // Optimistically flip a row to read + decrement the badge. Used by both
  // the row tap (navigates) and the per-row "✓" button (stays in dropdown).
  // Broadcasts so any open /notifications page updates in lockstep.
  const markOne = useCallback(async (id: string) => {
    let didFlip = false;
    setItems((prev) => {
      const target = prev.find((x) => x.id === id);
      if (!target || target.watched) return prev;
      didFlip = true;
      return prev.map((x) => (x.id === id ? { ...x, watched: true } : x));
    });
    if (!didFlip) return;
    setCount((prev) => Math.max(0, prev - 1));
    try {
      await markAdminNotificationRead(id);
    } catch {
      // Optimistic update stands; refreshCount tick reconciles.
    } finally {
      broadcastChange();
    }
  }, []);

  async function handleItemClick(n: AdminNotificationDto) {
    if (!n.watched) await markOne(n.id);
    setOpen(false);
    // The bell is the entry point for the personal notification inbox, so
    // route to the Notifications tab — alert-linked rows still land users
    // there first; the page itself lets them switch to the Alerts tab.
    if (n.alertId) router.push(`/notifications?tab=notifications`);
  }

  async function handleMarkAll() {
    const ids = items.filter((n) => !n.watched).map((n) => n.id);
    if (ids.length === 0) return;
    setMarkingAll(true);
    setItems((prev) => prev.map((x) => ({ ...x, watched: true })));
    // Badge is alerts + unread notifs combined — only the notification
    // slice is going to zero, so decrement by exactly the flipped count
    // and let the next poll reconcile if anything raced.
    setCount((prev) => Math.max(0, prev - ids.length));
    try {
      await markAdminNotificationsReadBulk(ids);
    } catch {
      // Optimistic update stands; next refresh reconciles.
    } finally {
      if (mountedRef.current) setMarkingAll(false);
      broadcastChange();
    }
  }

  function handleViewAll() {
    setOpen(false);
    router.push('/notifications?tab=notifications');
  }

  const display = count > 9 ? '9+' : String(count);
  const hasUnread = count > 0;
  const dropdownHasUnread = items.some((n) => !n.watched);

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
          {/* Header — title + unread badge + Mark all read action */}
          <div
            className="px-4 py-2.5 flex items-center justify-between gap-2"
            style={{ borderBottom: '1px solid var(--brand-border)' }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-[12px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                Notifications
              </p>
              {hasUnread && (
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: 'var(--brand-alert-red-light)',
                    color: 'var(--brand-alert-red)',
                  }}
                >
                  {count} unread
                </span>
              )}
            </div>
            {dropdownHasUnread && (
              <button
                type="button"
                onClick={handleMarkAll}
                disabled={markingAll}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 h-6 rounded-full cursor-pointer transition hover:opacity-80 disabled:opacity-50 shrink-0"
                style={{
                  color: 'var(--brand-primary-purple)',
                  backgroundColor: 'var(--brand-primary-purple-light)',
                }}
                aria-label="Mark all notifications as read"
              >
                <CheckCheck className="w-3 h-3" />
                {markingAll ? 'Marking…' : 'Mark all read'}
              </button>
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
                // Outer is a div (not a button) so the per-row "✓" pill is a
                // valid descendant — nested <button>s break HTML semantics
                // and trigger React's hydration error.
                <div
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => void handleItemClick(n)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void handleItemClick(n);
                    }
                  }}
                  className="w-full text-left px-4 py-2.5 flex items-start gap-2.5 transition-colors hover:bg-gray-50 cursor-pointer focus:outline-none focus-visible:bg-gray-50"
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
                  {/* Per-row mark-read affordance — only on unread rows. Stops
                      propagation so it doesn't trigger the row's navigate. */}
                  {!n.watched && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void markOne(n.id);
                      }}
                      className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition cursor-pointer hover:opacity-80 mt-0.5"
                      style={{
                        color: 'var(--brand-primary-purple)',
                        backgroundColor: 'var(--brand-primary-purple-light)',
                      }}
                      aria-label="Mark as read"
                      title="Mark as read"
                    >
                      <Check className="w-3 h-3" />
                    </button>
                  )}
                </div>
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
