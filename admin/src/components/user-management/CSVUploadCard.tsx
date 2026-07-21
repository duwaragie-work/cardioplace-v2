'use client';

// CSV bulk-invite card. Three-step UI:
//   1. Download a CSV template (generated client-side via Blob)
//   2. Upload a populated CSV (.csv only, capped at 500 rows)
//   3. Preview the parsed rows with per-row ✓ / ✗ and send all at once
//
// The CSV parser is hand-rolled — handles quoted commas and CRLF/LF row
// endings, but nothing fancier (no escaped quotes inside quotes). The
// upstream input format is well-defined (export from the template we
// hand out in step 1) so this is sufficient for the MVP without pulling
// in papaparse.

import { useMemo, useRef, useState } from 'react';
import { Check, Download, FileSpreadsheet, Loader2, Send, Upload, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/lib/auth-context';
import {
  invitableRoles,
  inviteRequiresPractice,
  type UserRole,
} from '@/lib/roleGates';
import {
  bulkInviteUsers,
  EMAIL_REGEX,
  type BulkInviteRowError,
} from '@/lib/services/user-management.service';
import type { PracticeOption } from './InviteUserModal';

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: (count: number) => void;
  practices: PracticeOption[];
  lockedRole?: UserRole;
  lockedPracticeId?: string;
}

interface ParsedRow {
  rowNumber: number; // 1-based index in the source CSV (header excluded)
  name: string;
  email: string;
  role: string;
  practiceId: string;
  error: string | null;
}

const TEMPLATE_HEADERS = ['name', 'email', 'role', 'practiceId'] as const;
const MAX_ROWS = 500;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      cur.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      cur.push(field);
      // Skip blank trailing rows.
      if (cur.length > 1 || cur[0].trim().length > 0) rows.push(cur);
      cur = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    if (cur.length > 1 || cur[0].trim().length > 0) rows.push(cur);
  }
  return rows;
}

function buildTemplate(): string {
  const headers = TEMPLATE_HEADERS.join(',');
  const example =
    'Jane Doe,jane@example.com,PATIENT,';
  return `${headers}\n${example}\n`;
}

function downloadTemplate() {
  const csv = buildTemplate();
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'user-invite-template.csv';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the browser kicks off the download first.
  window.setTimeout(() => URL.revokeObjectURL(url), 100);
}

export default function CSVUploadCard({
  open,
  onClose,
  onDone,
  practices,
  lockedRole,
  lockedPracticeId,
}: Props) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [parsedRows, setParsedRows] = useState<ParsedRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverErrors, setServerErrors] = useState<BulkInviteRowError[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const allowedRoles = useMemo(() => {
    if (lockedRole) return new Set<UserRole>([lockedRole]);
    return new Set<UserRole>(invitableRoles(user));
  }, [user, lockedRole]);

  const practiceIds = useMemo(
    () => new Set(practices.map((p) => p.id)),
    [practices],
  );

  function validateRow(row: ParsedRow): string | null {
    if (row.name.length === 0) return t('userManagement.error.nameRequired');
    if (row.email.length === 0) return t('userManagement.error.emailRequired');
    if (!EMAIL_REGEX.test(row.email))
      return t('userManagement.error.emailInvalid');
    const role = row.role as UserRole;
    if (!role) return t('userManagement.error.roleRequired');
    if (!allowedRoles.has(role)) return t('userManagement.error.roleRequired');
    if (!lockedPracticeId && inviteRequiresPractice(user, role)) {
      if (!row.practiceId) return t('userManagement.error.practiceRequired');
      if (!practiceIds.has(row.practiceId))
        return t('userManagement.error.practiceRequired');
    }
    return null;
  }

  async function handleFile(file: File) {
    setParseError(null);
    setServerErrors([]);
    setParsedRows(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) {
        setParseError(t('userManagement.error.csvParse'));
        return;
      }
      const [header, ...data] = rows;
      if (data.length === 0) {
        setParseError(t('userManagement.error.csvParse'));
        return;
      }
      if (data.length > MAX_ROWS) {
        setParseError(t('userManagement.error.tooManyRows'));
        return;
      }
      // Map columns by header so authors can re-order them.
      const idx = {
        name: header.findIndex(
          (h) => h.trim().toLowerCase() === 'name',
        ),
        email: header.findIndex(
          (h) => h.trim().toLowerCase() === 'email',
        ),
        role: header.findIndex(
          (h) => h.trim().toLowerCase() === 'role',
        ),
        practiceId: header.findIndex(
          (h) => h.trim().toLowerCase() === 'practiceid',
        ),
      };
      if (idx.name < 0 || idx.email < 0 || idx.role < 0) {
        setParseError(t('userManagement.error.csvParse'));
        return;
      }
      const next: ParsedRow[] = data.map((cells, i) => {
        const row: ParsedRow = {
          rowNumber: i + 1,
          name: (cells[idx.name] ?? '').trim(),
          email: (cells[idx.email] ?? '').trim().toLowerCase(),
          role: (cells[idx.role] ?? '').trim().toUpperCase(),
          practiceId:
            idx.practiceId >= 0 ? (cells[idx.practiceId] ?? '').trim() : '',
          error: null,
        };
        // Auto-fill locked fields if the CSV omitted them.
        if (lockedRole && !row.role) row.role = lockedRole;
        if (lockedPracticeId && !row.practiceId)
          row.practiceId = lockedPracticeId;
        row.error = validateRow(row);
        return row;
      });
      setParsedRows(next);
    } catch (e) {
      // 4.x — log only the message, never the raw error: a CSV parse failure
      // can carry row content (bulk user names/emails = PII) in the object.
      console.error(e instanceof Error ? e.message : 'CSV parse failed');
      setParseError(t('userManagement.error.csvParse'));
    }
  }

  function resetFile() {
    setParsedRows(null);
    setParseError(null);
    setServerErrors([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const validRows = parsedRows?.filter((r) => !r.error) ?? [];
  const allValid =
    !!parsedRows && parsedRows.length > 0 && parsedRows.every((r) => !r.error);

  async function handleSend() {
    if (!parsedRows || !allValid || submitting) return;
    setSubmitting(true);
    setServerErrors([]);
    try {
      const result = await bulkInviteUsers(
        parsedRows.map((r) => ({
          name: r.name,
          email: r.email,
          role: r.role as UserRole,
          practiceId: r.practiceId || lockedPracticeId || undefined,
        })),
      );
      if (result.statusCode === 422 && result.errors?.length) {
        setServerErrors(result.errors);
        // Tint the offending rows.
        setParsedRows((rows) =>
          rows
            ? rows.map((r, i) => {
                const err = result.errors!.find((e) => e.index === i);
                return err ? { ...r, error: err.reason } : r;
              })
            : rows,
        );
        return;
      }
      const count = result.data?.length ?? parsedRows.length;
      onDone(count);
      resetFile();
    } catch (e) {
      setParseError(
        e instanceof Error ? e.message : t('userManagement.error.csvParse'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <section
      className="bg-white rounded-2xl overflow-hidden"
      style={{ boxShadow: 'var(--brand-shadow-card)' }}
      aria-labelledby="csv-card-title"
      data-testid="admin-csv-upload-card"
    >
      <header
        className="px-5 py-3 flex items-center justify-between gap-3"
        style={{ borderBottom: '1px solid var(--brand-border)' }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-white"
            style={{ backgroundColor: 'var(--brand-primary-purple)' }}
            aria-hidden
          >
            <FileSpreadsheet className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2
              id="csv-card-title"
              className="text-[14px] font-bold"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              {t('userManagement.csv.title')}
            </h2>
            <p
              className="text-[11px] mt-0.5"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              {t('userManagement.bulk.atomicNotice')}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="btn-admin-ghost"
          aria-label={t('userManagement.csv.cancel')}
        >
          <X className="w-3.5 h-3.5" />
          {t('userManagement.csv.cancel')}
        </button>
      </header>

      <div className="grid md:grid-cols-3 gap-3 p-5">
        {/* Step 1 */}
        <div
          className="rounded-2xl p-4"
          style={{
            backgroundColor: 'var(--brand-primary-purple-ultra-light)',
            border: '1px solid var(--brand-border)',
          }}
        >
          <h3
            className="text-[13px] font-bold mb-1"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            {t('userManagement.csv.step1Title')}
          </h3>
          <p
            className="text-[11px] mb-3"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            {t('userManagement.csv.step1Body')}
          </p>
          <button
            type="button"
            onClick={downloadTemplate}
            className="btn-admin-secondary w-full"
            data-testid="admin-csv-download-template"
          >
            <Download className="w-3.5 h-3.5" />
            {t('userManagement.csv.step1Cta')}
          </button>
        </div>

        {/* Step 2 */}
        <div
          className="rounded-2xl p-4"
          style={{
            backgroundColor: 'var(--brand-primary-purple-ultra-light)',
            border: '1px solid var(--brand-border)',
          }}
        >
          <h3
            className="text-[13px] font-bold mb-1"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            {t('userManagement.csv.step2Title')}
          </h3>
          <p
            className="text-[11px] mb-3"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            {t('userManagement.csv.step2Body')}
          </p>
          <label
            className="btn-admin-secondary w-full cursor-pointer"
            htmlFor="admin-csv-file-input"
          >
            <Upload className="w-3.5 h-3.5" />
            {parsedRows
              ? t('userManagement.csv.reupload')
              : t('userManagement.csv.step2Cta')}
          </label>
          <input
            id="admin-csv-file-input"
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
            data-testid="admin-csv-file-input"
          />
        </div>

        {/* Step 3 */}
        <div
          className="rounded-2xl p-4"
          style={{
            backgroundColor: 'var(--brand-primary-purple-ultra-light)',
            border: '1px solid var(--brand-border)',
          }}
        >
          <h3
            className="text-[13px] font-bold mb-1"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            {t('userManagement.csv.step3Title')}
          </h3>
          <p
            className="text-[11px] mb-3"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            {t('userManagement.csv.step3Body')}
          </p>
          <button
            type="button"
            onClick={handleSend}
            disabled={!allValid || submitting}
            data-testid="admin-csv-send"
            className="btn-admin-primary w-full"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t('userManagement.bulk.sendingAll')}
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                {t('userManagement.csv.sendN').replace(
                  '{count}',
                  String(validRows.length),
                )}
              </>
            )}
          </button>
        </div>
      </div>

      {parseError && (
        <p
          className="mx-5 mb-5 text-[12px] font-semibold px-3 py-2 rounded-lg"
          style={{
            color: 'var(--brand-alert-red)',
            backgroundColor: 'var(--brand-alert-red-light)',
          }}
          role="alert"
        >
          {parseError}
        </p>
      )}

      {parsedRows && parsedRows.length > 0 && (
        <div
          className="mx-5 mb-5 rounded-2xl overflow-hidden"
          style={{ border: '1px solid var(--brand-border)' }}
        >
          {/* Preview header — summary + Clear button so the user can drop
              the current parse and upload a different file. */}
          <div
            className="flex items-center justify-between gap-3 px-3 py-2"
            style={{
              backgroundColor: 'var(--brand-background)',
              borderBottom: '1px solid var(--brand-border)',
            }}
          >
            <p
              className="text-[12px] font-semibold"
              style={{ color: 'var(--brand-text-secondary)' }}
            >
              {validRows.length}/{parsedRows.length} valid · ready to send
            </p>
            <button
              type="button"
              onClick={resetFile}
              disabled={submitting}
              data-testid="admin-csv-clear"
              className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer hover:bg-white disabled:opacity-50"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--brand-background)]">
                <tr>
                  <th
                    scope="col"
                    className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--brand-text-muted)' }}
                  >
                    #
                  </th>
                  <th
                    scope="col"
                    className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--brand-text-muted)' }}
                  >
                    {t('userManagement.field.name')}
                  </th>
                  <th
                    scope="col"
                    className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--brand-text-muted)' }}
                  >
                    {t('userManagement.field.email')}
                  </th>
                  <th
                    scope="col"
                    className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--brand-text-muted)' }}
                  >
                    {t('userManagement.field.role')}
                  </th>
                  <th
                    scope="col"
                    className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--brand-text-muted)' }}
                  >
                    {t('userManagement.field.status')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((row) => (
                  <tr
                    key={row.rowNumber}
                    style={{
                      borderTop: '1px solid var(--brand-border)',
                      backgroundColor: row.error
                        ? 'var(--brand-alert-red-light)'
                        : undefined,
                    }}
                    aria-invalid={!!row.error}
                  >
                    <td
                      className="px-3 py-2 text-[11px] font-bold"
                      style={{ color: 'var(--brand-text-muted)' }}
                    >
                      {row.rowNumber}
                    </td>
                    <td className="px-3 py-2 text-[13px]">{row.name || '—'}</td>
                    <td className="px-3 py-2 text-[12px]">{row.email || '—'}</td>
                    <td className="px-3 py-2 text-[12px]">{row.role || '—'}</td>
                    <td className="px-3 py-2 text-[12px]">
                      {row.error ? (
                        <span
                          className="inline-flex items-center gap-1 font-semibold"
                          style={{ color: 'var(--brand-alert-red)' }}
                        >
                          <X className="w-3 h-3" />
                          {row.error}
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 font-semibold"
                          style={{ color: 'var(--brand-success-green)' }}
                        >
                          <Check className="w-3 h-3" />
                          OK
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {serverErrors.length > 0 && (
        <p
          className="mx-5 mb-5 text-[12px] font-semibold px-3 py-2 rounded-lg"
          style={{
            color: 'var(--brand-alert-red)',
            backgroundColor: 'var(--brand-alert-red-light)',
          }}
          role="alert"
        >
          {serverErrors.length} server-side errors — see the table above. Fix and re-upload.
        </p>
      )}
    </section>
  );
}
