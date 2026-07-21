'use client';

// Group A addendum (2026-07-21, Ruhaim/Duwaragie) — the patient USER ID must
// never appear in a URL. This static /patients/detail shell resolves the patient
// WITHOUT ever reading a patient id from the query:
//   1. `?alert=<alertId>` (deep-link / in-app alert click) → resolve the patient
//      server-side via GET provider/alerts/:alertId/detail (practice-scoped),
//      then render. The alert id is an opaque ULID and is safe in the URL.
//   2. sessionStorage 'patientDetail' (in-app patients-list / care-team click,
//      which has no alert) → the id was handed off off-URL (lib/nav-handoff.ts).
//   3. neither → back to the list ("select a patient"), never an empty detail.
//
// `?alert=` wins over the stash so a fresh alert link is never shadowed by a
// stale in-tab stash. There is deliberately NO `?id=<patientUserId>` read.

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PatientDetailShell from '@/components/patient-detail/PatientDetailShell';
import { readNavId, NAV_HANDOFF_EVENT } from '@/lib/nav-handoff';
import { getAlertDetail } from '@/lib/services/provider.service';

function PatientDetailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const alertId = searchParams.get('alert');

  const [patientId, setPatientId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);

  // Resolve the patient from `?alert=` (server-side) or the sessionStorage
  // hand-off. Re-runs when `?alert=` changes (e.g. the bell hands off a new
  // alert while this page is already mounted on a different alert).
  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      setResolving(true);

      // 1. Alert deep-link / click → resolve the patient server-side.
      //    getAlertDetail() unwraps `data`, which carries the patient under
      //    `patient.id` (see provider.service.ts getAlertDetail return shape).
      if (alertId) {
        try {
          const detail = (await getAlertDetail(alertId)) as {
            patient?: { id?: string };
            user?: { id?: string };
            userId?: string;
          };
          const uid = detail?.patient?.id ?? detail?.user?.id ?? detail?.userId ?? null;
          if (cancelled) return;
          if (uid) {
            setPatientId(uid);
            setResolving(false);
          } else {
            router.replace('/patients');
          }
        } catch {
          if (!cancelled) router.replace('/patients');
        }
        return;
      }

      // 2. In-app patients-list / care-team click → off-URL stash.
      const stashed = readNavId('patientDetail')?.id;
      if (stashed) {
        if (!cancelled) {
          setPatientId(stashed);
          setResolving(false);
        }
        return;
      }

      // 3. Nothing to resolve (bare load, no stash — e.g. tab reopened).
      if (!cancelled) router.replace('/patients');
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [alertId, router]);

  // Same-route stash hand-off: the global NotificationBell can push a DIFFERENT
  // patient (a care-team notice with no alert) while we're already on the bare
  // route — a same-URL push that wouldn't remount. Re-read the stash on the
  // hand-off event. (Alert-carrying navs change `?alert=` and re-run the effect
  // above instead, so this only covers the no-alert stash path.)
  useEffect(() => {
    const onHandoff = (e: Event) => {
      if ((e as CustomEvent).detail?.key !== 'patientDetail') return;
      const next = readNavId('patientDetail')?.id;
      if (next) {
        setPatientId(next);
        setResolving(false);
      }
    };
    window.addEventListener(NAV_HANDOFF_EVENT, onHandoff);
    return () => window.removeEventListener(NAV_HANDOFF_EVENT, onHandoff);
  }, []);

  if (resolving || !patientId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-10 h-10 border-4 border-[#7B00E0] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  return <PatientDetailShell patientId={patientId} />;
}

export default function PatientDetailPage() {
  return (
    <Suspense fallback={null}>
      <PatientDetailContent />
    </Suspense>
  );
}
