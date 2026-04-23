'use client';

import { use } from 'react';
import PatientDetailShell from '@/components/patient-detail/PatientDetailShell';

export default function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // Next 16: params is a Promise — unwrap with `use()`.
  const { id } = use(params);
  return <PatientDetailShell patientId={id} />;
}
