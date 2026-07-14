'use client';

import { useState } from 'react';
import { KeyRound, RefreshCw, Fingerprint, CheckCircle2 } from 'lucide-react';
import type { SupportAction } from '@/lib/services/support.service';

export default function ActionButtons({
  locked,
  isPatient,
  resolved,
  mfaEnrolled,
  webAuthnCount,
  onAction,
  onResolve,
}: {
  locked: boolean; // true until identity is verified
  isPatient: boolean;
  resolved: boolean;
  mfaEnrolled: boolean;
  webAuthnCount: number;
  onAction: (a: SupportAction) => Promise<void>;
  onResolve: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  // Grey out actions the target has nothing to reset for — a "Reset MFA" on a
  // user with no authenticator is a confusing no-op (Fix 8). `locked` (identity
  // not yet verified) still gates everything on top of these.
  const noMfa = !mfaEnrolled;
  const noWebAuthn = webAuthnCount === 0;
  const noRecoveryBase = !mfaEnrolled && webAuthnCount === 0;

  const run = (key: string, fn: () => Promise<void>) => async () => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-3">
        Account actions
      </p>
      {locked && (
        <p className="text-[12px] text-amber-700 mb-3" data-testid="support-actions-locked">
          Verify the requester’s identity to unlock these actions.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <ActionBtn
          testid="support-action-mfa-reset"
          icon={<KeyRound className="w-3.5 h-3.5" />}
          label="Reset MFA"
          disabled={locked || noMfa || busy != null}
          tooltip={noMfa ? 'User has no authenticator (TOTP) enrolled' : undefined}
          busy={busy === 'mfa'}
          onClick={run('mfa', () => onAction('mfa-reset'))}
        />
        <ActionBtn
          testid="support-action-recovery"
          icon={<RefreshCw className="w-3.5 h-3.5" />}
          label="Regenerate recovery codes"
          disabled={locked || noRecoveryBase || busy != null}
          tooltip={
            noRecoveryBase
              ? 'User has no MFA method to generate recovery codes for'
              : undefined
          }
          busy={busy === 'recovery'}
          onClick={run('recovery', () => onAction('recovery-codes-regen'))}
        />
        {isPatient && (
          <ActionBtn
            testid="support-action-webauthn"
            icon={<Fingerprint className="w-3.5 h-3.5" />}
            label="Reset WebAuthn"
            disabled={locked || noWebAuthn || busy != null}
            tooltip={
              noWebAuthn ? 'User has no biometric/WebAuthn credentials' : undefined
            }
            busy={busy === 'webauthn'}
            onClick={run('webauthn', () => onAction('webauthn-reset'))}
          />
        )}
        <ActionBtn
          testid="support-action-resolve"
          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
          label={resolved ? 'Resolved' : 'Mark resolved'}
          disabled={resolved || busy != null}
          busy={busy === 'resolve'}
          onClick={run('resolve', onResolve)}
          solid
        />
      </div>
    </div>
  );
}

function ActionBtn({
  testid,
  icon,
  label,
  disabled,
  tooltip,
  busy,
  onClick,
  solid,
}: {
  testid: string;
  icon: React.ReactNode;
  label: string;
  disabled: boolean;
  tooltip?: string;
  busy: boolean;
  onClick: () => void;
  solid?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      disabled={disabled}
      title={tooltip}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-sm font-semibold disabled:opacity-50 transition ${
        solid
          ? 'text-white'
          : 'border border-[#7B00E0] text-[#7B00E0] hover:bg-[#7B00E0]/5'
      }`}
      style={solid ? { backgroundColor: 'var(--brand-primary-purple)' } : undefined}
    >
      {icon} {busy ? '…' : label}
    </button>
  );
}
