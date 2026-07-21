'use client';

// B3 (static export) — was the dynamic /patients/[id] route. It's now a static
// /patients/detail shell that reads the opaque patient id from `?id=` and
// fetches client-side (a dynamic segment can't be statically exported without
// baking real ids into the bundle). The list page stays at /patients.
// `useSearchParams` requires the Suspense boundary below.

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import PatientDetailShell from '@/components/patient-detail/PatientDetailShell';

function PatientDetailContent() {
  const id = useSearchParams().get('id') ?? '';
  return <PatientDetailShell patientId={id} />;
}

export default function PatientDetailPage() {
  return (
    <Suspense fallback={null}>
      <PatientDetailContent />
    </Suspense>
  );
}
