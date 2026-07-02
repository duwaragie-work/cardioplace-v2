'use client';

// Coordinator (front-desk) patient roster. Minimum-necessary: identity +
// onboarding + current care team only — NO clinical data.
//
// 2026-07-01 walkback (#116): coordinators no longer assign / reassign care
// teams (that is a clinical decision — MED_DIR / OPS / SUPER only). The care
// team is shown READ-ONLY here; the assign/edit control was removed. See
// docs/ACCESS_SCOPE.md §6.

import { useCallback, useEffect, useState } from 'react';
import { Users, Search, Loader2 } from 'lucide-react';
import {
  getCoordinatorPatients,
  type CoordinatorPatient,
} from '@/lib/services/coordinator.service';

function onboardingBadge(status: string): { label: string; bg: string; color: string } {
  if (status === 'COMPLETED') {
    return { label: 'Onboarded', bg: 'var(--brand-success-green-light)', color: 'var(--brand-success-green)' };
  }
  return { label: 'Pending', bg: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber-text)' };
}

export default function CoordinatorPatientsView() {
  const [patients, setPatients] = useState<CoordinatorPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { patients: p } = await getCoordinatorPatients();
      setPatients(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load patients.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = patients.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (p.name ?? '').toLowerCase().includes(q) ||
      (p.email ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="h-full" style={{ backgroundColor: '#FAFBFF' }}>
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
            >
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                Patients
              </h1>
              <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
                {loading ? '…' : `${patients.length} patients in your practice`}
              </p>
            </div>
          </div>
          <div
            className="flex items-center gap-2 px-3 h-9 rounded-full w-full sm:w-64"
            style={{ backgroundColor: 'white', border: '1.5px solid var(--brand-border)' }}
          >
            <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-text-muted)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email"
              data-testid="coordinator-patient-search"
              className="flex-1 text-[12px] outline-none bg-transparent min-w-0"
              style={{ color: 'var(--brand-text-primary)' }}
            />
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="text-sm font-semibold px-3 py-2 rounded-lg mb-4"
            style={{ color: 'var(--brand-alert-red)', backgroundColor: 'var(--brand-alert-red-light)' }}
          >
            {error}
          </p>
        )}

        {/* Table */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: '0 1px 20px rgba(123,0,224,0.07)' }}>
          <div
            className="hidden md:grid items-center px-5 py-3 text-[10px] font-bold uppercase tracking-wider gap-3"
            style={{
              color: 'var(--brand-text-muted)',
              gridTemplateColumns: '1.6fr 1fr 1.4fr',
              borderBottom: '1px solid var(--brand-border)',
            }}
          >
            <span>Patient</span>
            <span>Onboarding</span>
            <span>Care team</span>
          </div>

          {loading ? (
            <div className="py-16 text-center">
              <Loader2 className="w-6 h-6 mx-auto animate-spin" style={{ color: 'var(--brand-primary-purple)' }} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center" data-testid="coordinator-patient-empty">
              <Users className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--brand-border)' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--brand-text-muted)' }}>
                No patients yet.
              </p>
            </div>
          ) : (
            filtered.map((p, i) => {
              const ob = onboardingBadge(p.onboardingStatus);
              const primary = p.careTeam?.primaryProvider?.name;
              return (
                <div
                  key={p.id}
                  data-testid={`coordinator-patient-row-${p.id}`}
                  className="px-5 py-3.5 flex items-center gap-3 md:grid md:gap-3"
                  style={{
                    gridTemplateColumns: '1.6fr 1fr 1.4fr',
                    borderTop: i > 0 ? '1px solid var(--brand-border)' : 'none',
                  }}
                >
                  <div className="min-w-0 flex-1 md:flex-none">
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                      {p.name ?? 'Unknown'}
                    </p>
                    <p className="text-[11px] truncate" style={{ color: 'var(--brand-text-muted)' }}>
                      {p.email ?? '—'}
                    </p>
                  </div>
                  <div className="hidden md:block">
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                      style={{ backgroundColor: ob.bg, color: ob.color }}
                    >
                      {ob.label}
                    </span>
                  </div>
                  <div className="hidden md:block min-w-0">
                    <p className="text-[12px] truncate" style={{ color: primary ? 'var(--brand-text-secondary)' : 'var(--brand-text-muted)' }}>
                      {primary ? `Dr. ${primary}` : 'Not assigned'}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
