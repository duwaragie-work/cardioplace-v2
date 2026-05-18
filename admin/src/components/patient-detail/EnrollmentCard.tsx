'use client';

// Patient-detail Enrollment CTA. Mirrors the K3 OnboardingCell on the
// patient list page so the same enroll action is available from inside
// patient detail without forcing an admin to back out to the list.
//
// • Hidden once enrollmentStatus === 'ENROLLED' (button disappears once
//   activated, per bug ticket "EXPECTED" guidance).
// • On mount runs the enrollment-check endpoint to populate gate reasons
//   so the button reflects readiness without first having to click and
//   eat a 409. The server is still authoritative — the click also handles
//   a fresh 409 and updates reasons accordingly.
// • Reuses the same completePatientEnrollment + ENROLLMENT_REASON_LABELS
//   used by the list page — single source of truth, no behavior fork.
//
// Backend unchanged: same /admin/patients/:id/enrollment-check (GET) and
// /admin/patients/:id/complete-enrollment (POST) endpoints the list page
// already uses.

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import {
  ENROLLMENT_REASON_LABELS,
  completePatientEnrollment,
  getEnrollmentCheck,
  type EnrollmentGateReason,
} from '@/lib/services/practice.service';

interface Props {
  patientId: string;
  enrollmentStatus: string | null | undefined;
  /** Fired after a successful enrollment. The shell uses it to refetch
   *  the header (so the verification + activation pills update) and the
   *  verification logs (so the timeline picks up the new audit entry). */
  onEnrolled: () => void;
  /** Bumped by the shell whenever something that could affect the
   *  enrollment gate changes — care-team save, threshold save, profile
   *  edit. We re-run getEnrollmentCheck on every change so the button
   *  flips from "Blocked" to "Enroll patient" without a page refresh. */
  refreshTrigger?: number;
}

export default function EnrollmentCard({
  patientId,
  enrollmentStatus,
  onEnrolled,
  refreshTrigger = 0,
}: Props) {
  const [reasons, setReasons] = useState<EnrollmentGateReason[] | null>(null);
  const [checkLoading, setCheckLoading] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEnrolled = enrollmentStatus === 'ENROLLED';

  // Run the enrollment-check on mount + whenever the patient changes OR
  // the parent signals a prerequisite-affecting change via refreshTrigger.
  // Without the refreshTrigger dep, the card would cache the gate result
  // forever and a fresh care-team save would leave the button stuck at
  // "Blocked" until the user manually reloaded the page.
  const runCheck = useCallback(async () => {
    if (isEnrolled) return;
    setCheckLoading(true);
    setError(null);
    try {
      const result = await getEnrollmentCheck(patientId);
      setReasons(result.ok ? [] : result.reasons);
    } catch (e) {
      // Soft-fail — leave reasons as null so the button stays enabled and
      // the server-side gate enforces correctness on click.
      setError(e instanceof Error ? e.message : 'Could not check prerequisites.');
    } finally {
      setCheckLoading(false);
    }
  }, [patientId, isEnrolled]);

  useEffect(() => {
    void runCheck();
    // refreshTrigger is intentionally a dep — bumping it from the parent
    // forces a re-check after care-team / threshold / profile edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runCheck, refreshTrigger]);

  // Hide entirely once enrolled — bug ticket "button disappears once
  // ENROLLED" guidance. The header pill still shows verified/unverified
  // status; an "Enrolled" pill on the header is a follow-up if needed.
  if (isEnrolled) return null;

  const blocked = reasons != null && reasons.length > 0;

  const handleEnroll = async () => {
    setEnrolling(true);
    setError(null);
    try {
      await completePatientEnrollment(patientId);
      // Success — let the parent refetch the header so this card
      // unmounts on the next render.
      onEnrolled();
    } catch (e) {
      // 409 case: the service rethrows with a `reasons` array attached.
      const reasonsFromErr = (e as Error & { reasons?: EnrollmentGateReason[] })
        .reasons;
      if (Array.isArray(reasonsFromErr)) {
        setReasons(reasonsFromErr);
      }
      setError(e instanceof Error ? e.message : 'Could not enroll patient.');
    } finally {
      setEnrolling(false);
    }
  };

  return (
    <div
      className="bg-white rounded-2xl p-4 md:p-5"
      style={{
        boxShadow: 'var(--brand-shadow-card)',
        borderLeft: `4px solid ${blocked ? 'var(--brand-warning-amber)' : 'var(--brand-primary-purple)'}`,
      }}
      role="region"
      aria-label="Enrollment"
      data-testid="admin-enrollment-card"
    >
      <div className="flex items-start gap-3 md:gap-4">
        <div
          className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
          style={{
            backgroundColor: blocked
              ? 'var(--brand-warning-amber-light)'
              : 'var(--brand-primary-purple-light)',
            color: blocked
              ? 'var(--brand-warning-amber)'
              : 'var(--brand-primary-purple)',
          }}
          aria-hidden
        >
          {blocked ? <ShieldAlert className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-bold leading-tight" style={{ color: 'var(--brand-text-primary)' }} data-testid="admin-enrollment-status">
            Patient not enrolled
          </p>
          <p className="text-[11.5px] mt-0.5 leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
            {blocked
              ? 'Resolve the prerequisites below to activate clinical monitoring.'
              : 'Activate this patient to start the alert + escalation pipeline.'}
          </p>

          {/* Inline reason list when prerequisites are missing. Mirrors
              the wording from the patient-list tooltip via the same
              ENROLLMENT_REASON_LABELS map. */}
          {blocked && (
            <ul className="mt-2.5 space-y-1.5">
              {reasons!.map((r) => (
                <li
                  key={r}
                  className="text-[11.5px] leading-relaxed flex items-start gap-1.5"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  <span style={{ color: 'var(--brand-warning-amber-text)' }}>•</span>
                  <span>{ENROLLMENT_REASON_LABELS[r] ?? r}</span>
                </li>
              ))}
            </ul>
          )}

          {error && !blocked && (
            <p
              className="mt-2 text-[11.5px] font-semibold"
              style={{ color: 'var(--brand-alert-red)' }}
            >
              {error}
            </p>
          )}
        </div>

        <div className="shrink-0">
          <button
            type="button"
            onClick={handleEnroll}
            data-testid="admin-enrollment-enroll-button"
            disabled={blocked || enrolling || checkLoading}
            className="h-9 px-3.5 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1.5 transition-all hover:brightness-95 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              backgroundColor: blocked ? 'white' : 'var(--brand-primary-purple)',
              color: blocked ? 'var(--brand-text-muted)' : 'white',
              border: blocked ? '1px solid var(--brand-border)' : 'none',
            }}
            title={
              blocked
                ? 'Cannot enroll — prerequisites missing.'
                : 'Activate this patient'
            }
          >
            {enrolling ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Enrolling…
              </>
            ) : checkLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Checking…
              </>
            ) : blocked ? (
              <>
                <ShieldAlert className="w-3.5 h-3.5" />
                Blocked
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                Enroll patient
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
