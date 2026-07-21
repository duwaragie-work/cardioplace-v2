'use client';

// B3/F1 (static export) — static /patients/detail shell.
//
// The opaque patient id comes from the URL `?id=` (external email/push
// deep-links) OR sessionStorage (in-app clicks, which navigate to the BARE
// route so the id never reaches the CDN access log — see lib/nav-handoff.ts).
// URL wins when present so a fresh deep-link is never shadowed by a stale stash.
// If neither is present (bare load, no stash — e.g. tab reopened) → back to the
// list, never an empty detail. `useSearchParams` needs the Suspense boundary.

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PatientDetailShell from '@/components/patient-detail/PatientDetailShell';
import { readNavId, NAV_HANDOFF_EVENT } from '@/lib/nav-handoff';

function PatientDetailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [id, setId] = useState(
    () => searchParams.get('id') ?? readNavId('patientDetail')?.id ?? '',
  );

  // The NotificationBell is global, so it can hand off a DIFFERENT patient while
  // this detail page is already mounted on the bare route — a same-URL push that
  // wouldn't remount. Re-read the stash on the hand-off event so we switch.
  useEffect(() => {
    const onHandoff = (e: Event) => {
      if ((e as CustomEvent).detail?.key !== 'patientDetail') return;
      const next = readNavId('patientDetail')?.id;
      if (next) setId(next);
    };
    window.addEventListener(NAV_HANDOFF_EVENT, onHandoff);
    return () => window.removeEventListener(NAV_HANDOFF_EVENT, onHandoff);
  }, []);

  useEffect(() => {
    if (!id) router.replace('/patients');
  }, [id, router]);

  if (!id) return null;
  return <PatientDetailShell patientId={id} />;
}

export default function PatientDetailPage() {
  return (
    <Suspense fallback={null}>
      <PatientDetailContent />
    </Suspense>
  );
}
