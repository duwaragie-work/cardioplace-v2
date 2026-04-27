'use client';

// Patient alert detail (Flow C). Fetches the alert by id, then dispatches:
//   • BP_LEVEL_2 / BP_LEVEL_2_SYMPTOM_OVERRIDE → EmergencyAlertScreen (C1+C2)
//   • TIER_1_CONTRAINDICATION                   → TierAlertView (C3, red)
//   • BP_LEVEL_1_HIGH                           → TierAlertView (C4, orange)
//   • BP_LEVEL_1_LOW                            → TierAlertView (C5, blue)
//   • TIER_3_INFO                               → TierAlertView (passive green)
//   • TIER_2_DISCREPANCY                        → admin-only → soft 404
//
// Backend has no GET /alerts/:id yet — we fetch the user's alert list and
// find by id. For a typical patient that's a small list. Replace with a
// dedicated endpoint when one lands.

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, AlertCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  getAlerts,
  acknowledgeAlert,
  type DeviationAlertDto,
} from '@/lib/services/journal.service';
import EmergencyAlertScreen from '@/components/alerts/EmergencyAlertScreen';
import TierAlertView from '@/components/alerts/TierAlertView';

interface PageProps {
  params: Promise<{ id: string }>;
}

function AlertSkeleton() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FAFBFF' }}>
      <div className="max-w-2xl mx-auto px-4 md:px-8 py-6 space-y-5">
        <div
          className="rounded-2xl p-5 sm:p-6"
          style={{ backgroundColor: 'white', border: '1.5px solid var(--brand-border)' }}
        >
          <div className="flex items-start gap-4">
            <div
              className="rounded-2xl animate-pulse"
              style={{ width: 56, height: 56, backgroundColor: '#EDE9F6' }}
            />
            <div className="flex-1 space-y-3">
              <div
                className="h-5 rounded-md animate-pulse"
                style={{ width: '70%', backgroundColor: '#EDE9F6' }}
              />
              <div
                className="h-3 rounded-md animate-pulse"
                style={{ width: '40%', backgroundColor: '#EDE9F6' }}
              />
              <div
                className="h-3 rounded-md animate-pulse"
                style={{ width: '90%', backgroundColor: '#EDE9F6' }}
              />
              <div
                className="h-3 rounded-md animate-pulse"
                style={{ width: '85%', backgroundColor: '#EDE9F6' }}
              />
            </div>
          </div>
        </div>
        <div
          className="rounded-2xl p-5 animate-pulse"
          style={{ height: 90, backgroundColor: '#EDE9F6' }}
        />
        <div
          className="rounded-full animate-pulse"
          style={{ height: 48, backgroundColor: '#EDE9F6' }}
        />
      </div>
    </div>
  );
}

/**
 * Friendly "no action needed" screen for alerts that are admin-only
 * (Tier 2 medication-discrepancy). The alert exists — it's just not for
 * the patient to act on. Distinct from NotFound so the user doesn't think
 * something is broken when they arrive here from a stale link.
 */
function CareTeamOnly() {
  const router = useRouter();
  const { t } = useLanguage();
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: '#FAFBFF' }}
    >
      <div className="max-w-sm w-full text-center">
        <div
          className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
          style={{ backgroundColor: 'var(--brand-success-green-light)' }}
        >
          <ShieldCheck
            className="w-8 h-8"
            style={{ color: 'var(--brand-success-green)' }}
          />
        </div>
        <h1
          className="text-[20px] font-bold mb-2"
          style={{ color: 'var(--brand-text-primary)' }}
        >
          Reviewed by your care team
        </h1>
        <p
          className="text-[13.5px] mb-6 leading-relaxed"
          style={{ color: 'var(--brand-text-secondary)' }}
        >
          {t('alerts.notFound.tier2')}
        </p>
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="inline-flex items-center gap-2 h-11 px-6 rounded-full text-white font-bold text-[14px] cursor-pointer"
          style={{
            backgroundColor: 'var(--brand-primary-purple)',
            boxShadow: 'var(--brand-shadow-button)',
          }}
        >
          <ArrowLeft className="w-4 h-4" />
          {t('alerts.notFound.backToDashboard')}
        </button>
      </div>
    </div>
  );
}

function NotFound({ reason }: { reason: string }) {
  const router = useRouter();
  const { t } = useLanguage();
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: '#FAFBFF' }}
    >
      <div className="max-w-sm w-full text-center">
        <div
          className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
          style={{ backgroundColor: 'var(--brand-warning-amber-light)' }}
        >
          <AlertCircle
            className="w-8 h-8"
            style={{ color: 'var(--brand-warning-amber)' }}
          />
        </div>
        <h1
          className="text-[20px] font-bold mb-2"
          style={{ color: 'var(--brand-text-primary)' }}
        >
          {t('alerts.notFound.title')}
        </h1>
        <p
          className="text-[13.5px] mb-6 leading-relaxed"
          style={{ color: 'var(--brand-text-secondary)' }}
        >
          {reason}
        </p>
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="inline-flex items-center gap-2 h-11 px-6 rounded-full text-white font-bold text-[14px] cursor-pointer"
          style={{
            backgroundColor: 'var(--brand-primary-purple)',
            boxShadow: 'var(--brand-shadow-button)',
          }}
        >
          <ArrowLeft className="w-4 h-4" />
          {t('alerts.notFound.backToDashboard')}
        </button>
      </div>
    </div>
  );
}

export default function AlertDetailPage({ params }: PageProps) {
  // Next 16: dynamic route params come back as a Promise — unwrap with `use`.
  const { id } = use(params);
  const router = useRouter();
  const { isLoading, isAuthenticated } = useAuth();
  const { t } = useLanguage();

  const [alert, setAlert] = useState<DeviationAlertDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ackLoading, setAckLoading] = useState(false);

  // Auth gate
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/sign-in');
    }
  }, [isAuthenticated, isLoading, router]);

  // Fetch alerts and find by id
  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await getAlerts();
        if (cancelled) return;
        const found = Array.isArray(list) ? list.find((a) => a.id === id) : null;
        if (!found) {
          setError(t('alerts.notFound.body'));
        } else {
          setAlert(found);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : t('alerts.notFound.loadError'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isAuthenticated, isLoading, t]);

  async function handleAcknowledge() {
    if (!alert || ackLoading) return;
    // CLINICAL_SPEC V2-C — Tier 1 contraindications (and any other alert the
    // backend marks `dismissible: false`) cannot be acknowledged by the
    // patient. The acknowledge endpoint sets acknowledgedAt + status=
    // ACKNOWLEDGED, which the escalation cron treats as "stop paging." If
    // the patient could acknowledge a Tier 1, the provider ladder would
    // silently die — a clinical-safety hole. Defense in depth: the child
    // views also hide the button when dismissible=false; this guard
    // ensures even a stray prop wiring can't bypass the rule.
    if (alert.dismissible === false) return;
    setAckLoading(true);
    try {
      await acknowledgeAlert(alert.id);
      // optimistic: mirror the new status locally so the view flips to
      // "I've seen this" without a refetch round-trip
      setAlert((prev) =>
        prev
          ? { ...prev, status: 'ACKNOWLEDGED', acknowledgedAt: new Date().toISOString() }
          : prev,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t('alerts.notFound.ackError'));
    } finally {
      setAckLoading(false);
    }
  }

  if (isLoading || loading) {
    return <AlertSkeleton />;
  }

  if (error || !alert) {
    return <NotFound reason={error || t('alerts.notFound.unavailable')} />;
  }

  // Dispatch by tier — and fall back to BP-reading thresholds when the
  // rule engine hasn't tagged this row yet (legacy v1 alert with tier=null).
  // Per CLINICAL_SPEC, SBP ≥180 OR DBP ≥120 is BP Level 2 regardless of how
  // it was originally classified, so we route it to the emergency screen.
  const tier = alert.tier;
  const sbp = alert.journalEntry?.systolicBP ?? 0;
  const dbp = alert.journalEntry?.diastolicBP ?? 0;
  const isEmergency =
    tier === 'BP_LEVEL_2' ||
    tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE' ||
    (tier == null && (sbp >= 180 || dbp >= 120));

  if (tier === 'TIER_2_DISCREPANCY') {
    // Tier 2 is admin-only per V2-C. Patients shouldn't land here from
    // the dashboard (Recent Alerts filters Tier 2 out), but a stale link
    // or bookmark can still lead here — render a friendly "reviewed by
    // your care team" screen instead of a misleading "not found" error.
    return <CareTeamOnly />;
  }

  // Only show the full-screen red takeover for OPEN emergencies. Once the
  // patient has acknowledged (or care team resolved it), fall through to the
  // banner-style TierAlertView so they see a clear "you've seen this" state
  // instead of being trapped on a 911-prompt with no exit.
  const isResolved = alert.status === 'ACKNOWLEDGED' || alert.status === 'RESOLVED';
  if (isEmergency && !isResolved) {
    return <EmergencyAlertScreen alert={alert} onAcknowledge={handleAcknowledge} />;
  }

  return (
    <TierAlertView
      alert={alert}
      acknowledging={ackLoading}
      onAcknowledge={handleAcknowledge}
    />
  );
}
