'use client';

// Settings card: turn out-of-app push notifications on/off for THIS device.
// Browser notification permission is per-site, not per-account — so this shows
// the live state (On / Blocked / Off) and lets the patient (re)enable or turn
// it off without digging into browser settings. Enabling reuses the same
// ceremony as auto-registration; disabling drops this browser's subscription.

import { useCallback, useEffect, useState } from 'react';
import { Bell, Loader2, Check, Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  getPushStatus,
  enablePush,
  disablePush,
  type PushStatus,
  type PushEnableResult,
} from '@/lib/services/push.service';

export default function NotificationSettings() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await getPushStatus());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const noticeForResult = (r: PushEnableResult): string => {
    switch (r) {
      case 'enabled':
        return t('settings.notif.turnedOn');
      case 'denied':
        return t('settings.notif.blockedHelp');
      case 'unsupported':
        return t('settings.notif.unsupported');
      default:
        return t('settings.notif.error');
    }
  };

  async function handleEnable() {
    setBusy(true);
    setNotice(null);
    const result = await enablePush();
    setNotice(noticeForResult(result));
    await refresh();
    setBusy(false);
  }

  async function handleDisable() {
    setBusy(true);
    setNotice(null);
    await disablePush();
    setNotice(t('settings.notif.turnedOff'));
    await refresh();
    setBusy(false);
  }

  // Derive the visible state. `blocked` is terminal for in-app control — the
  // browser won't let us re-prompt, so we guide the user to browser settings.
  const supported = status?.supported ?? false;
  const blocked = status?.permission === 'denied';
  const on = status?.subscribed ?? false;

  return (
    <section
      className="rounded-2xl bg-white overflow-hidden"
      style={{ border: '1px solid var(--brand-border)' }}
    >
      <div className="p-5 flex items-start gap-4">
        <span
          className="shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center text-white"
          style={{
            background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
            boxShadow: '0 4px 16px rgba(123,0,224,0.28)',
          }}
          aria-hidden
        >
          <Bell className="w-6 h-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              className="text-[15px] font-bold"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              {t('settings.notif.title')}
            </h2>
            {on ? (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                style={{
                  backgroundColor: 'var(--brand-success-green-light, #DCFCE7)',
                  color: 'var(--brand-success-green, #166534)',
                }}
              >
                <Check className="w-3 h-3" />
                {t('settings.badge.on')}
              </span>
            ) : blocked ? (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                style={{
                  backgroundColor: 'var(--brand-danger-red-light, #FEE2E2)',
                  color: 'var(--brand-danger-red, #B91C1C)',
                }}
              >
                {t('settings.notif.badgeBlocked')}
              </span>
            ) : (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                style={{
                  backgroundColor: 'var(--brand-background, #FAFBFF)',
                  color: 'var(--brand-text-muted)',
                }}
              >
                {t('settings.notif.badgeOff')}
              </span>
            )}
          </div>
          <p
            className="text-[13px] mt-0.5 leading-relaxed"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            {t('settings.notif.desc')}
          </p>
        </div>
      </div>

      <div className="px-5 pb-5">
        {notice && (
          <div
            className="flex items-start gap-2.5 rounded-xl px-3 py-3 text-[13px] mb-3"
            style={{
              backgroundColor: 'var(--brand-background, #FAFBFF)',
              color: 'var(--brand-text-muted)',
            }}
          >
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {!supported ? (
          <div
            className="flex items-start gap-2.5 rounded-xl px-3 py-3 text-[13px]"
            style={{
              backgroundColor: 'var(--brand-background, #FAFBFF)',
              color: 'var(--brand-text-muted)',
            }}
          >
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{t('settings.notif.unsupported')}</span>
          </div>
        ) : blocked ? (
          <div
            className="flex items-start gap-2.5 rounded-xl px-3 py-3 text-[13px]"
            style={{
              backgroundColor: 'var(--brand-background, #FAFBFF)',
              color: 'var(--brand-text-muted)',
            }}
          >
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{t('settings.notif.blockedHelp')}</span>
          </div>
        ) : on ? (
          <button
            type="button"
            data-testid="settings-notif-disable"
            onClick={() => void handleDisable()}
            disabled={busy}
            className="w-full h-12 rounded-full border border-[#7B00E0] font-semibold text-[#7B00E0] text-sm hover:bg-[#7B00E0]/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer inline-flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('settings.notif.working')}
              </>
            ) : (
              t('settings.notif.turnOff')
            )}
          </button>
        ) : (
          <button
            type="button"
            data-testid="settings-notif-enable"
            onClick={() => void handleEnable()}
            disabled={busy}
            className="w-full h-12 rounded-full bg-[#7B00E0] font-semibold text-white text-sm hover:bg-[#6600BC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer inline-flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('settings.notif.working')}
              </>
            ) : (
              <>
                <Bell className="w-4 h-4" />
                {t('settings.notif.turnOn')}
              </>
            )}
          </button>
        )}
      </div>
    </section>
  );
}
