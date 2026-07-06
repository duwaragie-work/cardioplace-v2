'use client';

// /audit — HIPAA audit-review console (§164.312(b) L2, the "examine" half).
// Gated by <AuditAccessGate/> (L1): SUPER_ADMIN / HEALPLACE_OPS role AND a
// recorded Rules-of-Behavior acknowledgment before any audit record is shown.
// Backend read endpoints: /api/v2/admin/audit/access-log + /auth-log.

import AuditAccessGate from '@/components/audit/AuditAccessGate';
import AuditConsole from '@/components/audit/AuditConsole';

export default function AuditPage() {
  return (
    <AuditAccessGate>
      <div className="h-full" style={{ backgroundColor: '#FAFBFF' }}>
        <AuditConsole />
      </div>
    </AuditAccessGate>
  );
}
