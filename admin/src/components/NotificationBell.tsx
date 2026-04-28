'use client';

// Top-bar notification bell with unread badge.
//
// Polls GET /daily-journal/notifications/unread-count every 30s — short
// enough to feel near-real-time for a clinical alert workflow, long enough
// to stay cheap (one indexed COUNT(*) per admin tab per minute is fine).
// Clicking the bell jumps to /dashboard, where the active alert banners
// surface the actual content. Future work: open a dropdown listing recent
// notifications; for MVP the dashboard is the single source of truth.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { fetchWithAuth } from '@/lib/services/token';

const POLL_INTERVAL_MS = 30_000;
const API = process.env.NEXT_PUBLIC_API_URL;

export default function NotificationBell() {
  const router = useRouter();
  const [count, setCount] = useState(0);
  // Use a ref so the polling loop doesn't tear down on every count change —
  // the interval reads the latest fetch fn via closure of the stable refresh.
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${API}/api/daily-journal/notifications/unread-count`);
      if (!res.ok) return;
      const json = await res.json();
      const next = Number(json?.data?.unread ?? 0);
      if (mountedRef.current && Number.isFinite(next)) {
        setCount(next);
      }
    } catch {
      // Silent — the bell shouldn't pull error noise into the top bar. The
      // count will refresh on the next tick.
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  const display = count > 9 ? '9+' : String(count);
  const hasUnread = count > 0;

  return (
    <button
      type="button"
      onClick={() => router.push('/dashboard')}
      className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer transition-colors relative"
      style={{ color: 'var(--brand-text-secondary)' }}
      aria-label={
        hasUnread
          ? `Notifications — ${count} unread`
          : 'Notifications — none unread'
      }
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
  );
}
