'use client';

// /worklist — L3 reviewer worklist (HIPAA §164.312(b) act + §164.308(a)(6)).
// Triages the AuditException rows N7's cron produces (acknowledge / mark-benign
// / escalate) and runs the security-incident lifecycle. Same gate as the L2
// console: SUPER_ADMIN / HEALPLACE_OPS role AND a Rules-of-Behavior ack.
// Backend: /api/v2/admin/worklist/*.

import AuditAccessGate from '@/components/audit/AuditAccessGate';
import Worklist from '@/components/worklist/Worklist';

export default function WorklistPage() {
  return (
    <AuditAccessGate>
      <div className="h-full" style={{ backgroundColor: '#FAFBFF' }}>
        <Worklist />
      </div>
    </AuditAccessGate>
  );
}
