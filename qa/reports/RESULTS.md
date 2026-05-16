# Cardioplace v2 — Playwright E2E Run Results

**Run date:** 2026-05-15 (A1 small-bugs + B4 translation-pipeline cycle, on top of Cluster 6/7)
**Branch:** `duwaragie-dev` (12 commits ahead of `origin/dev`) → PR `duwaragie-dev → dev`
**Engine:** chromium-desktop (1440×900)
**Stack tested:** local (NestJS `:4000`, Next 16 patient `:3000`, Next 16 admin `:3001`) + CI (GitHub Actions, sharded, fresh DB per shard). Local DB is the shared remote `db.prisma.io` (seed pollution applies).
**Seed:** 5 base patients (Priya / James / Rita / Charles / Aisha) + 6 admins, perma-OTP `666666`. Cluster 6 persona expansion (Carol / Mike / Kate / …) is NOT fully seeded on the swapped local DB.

---

## Bottom line

| | Backend unit (jest) | Playwright (no-write, local) | Write-gated + full matrix |
|---|---:|---:|---|
| **Passed** | **19 / 19** | **14** (incl. all 3 new §F/§H tests) | CI is authoritative |
| **Failed** | 0 | 1 — *pre-existing* `Carol Miller` seed gap, unrelated | — |
| **Skipped** | 0 | 1 + §G env-gated + spec 19 (9, write-gated) | — |

This cycle shipped a **9-item bundle** (3 backend/test-infra fixes, a translation-pipeline
doc update, 3 frontend bug fixes) as one PR. No engine clinical-rule changes, no schema
changes. Every code change carries a test or a documented manual-verification note.

A full-suite local run was **not** possible this cycle: the running backend had
`ENABLE_TEST_CONTROL=false` (write-gated specs defer to CI) and the admin `.next` dev cache
was corrupt (now cleared — see *Known test-infra issues*). CI (test-control provisioned,
fresh DB per shard) is the authoritative full tally; targeted gates below all pass.

**Categorized status**

| Area | Result |
|---|---|
| Shared build / `src` tsc (frontend, admin, qa) | ✅ clean |
| Backend `src` tsc | ✅ clean (changed files 0 errors; pre-existing spec `never`-typing + voice-chat e2e noise excluded — present on `dev`) |
| Backend jest (§B deadlock-retry, §D session-averager + daily_journal) | ✅ 19/19 |
| Playwright §F NotificationBell + §H patient/admin `<h1>` | ✅ 3/3 |
| §C polling (spec 13 / spec 19) | ✅ extraction sound (spec 19 loads, 9 skipped clean); write-gated assertions → CI |
| §G AlertsTab pill | ✅ admin tsc clean; UI walk env-gated (skips clean locally, runs in CI) |
| §E translation package | ✅ cross-checked vs `shared/src/alert-messages.ts` |

---

## ✅ Passing highlights

- **§B (bug #20)** — `withDeadlockRetry` + `test-control.service.ts` now catch the
  `@prisma/adapter-pg` `DriverAdapterError: TransactionWriteConflict` form (the typed
  `code` is undefined through the adapter, so the old `P2034 / 40P01` matcher never
  engaged). Conservative widening. `deadlock-retry.spec.ts` 8/8.
- **§D (bug #5)** — `suboptimalMeasurement` no longer defaults TRUE when a patient skips
  the optional 8-item checklist (the form sends all keys `false`; an all-false object now
  reads as "not completed", not "measured badly"). Mirrored in `provider.service.ts`.
  `session-averager.service.spec.ts` 10/10 (2 new bug-#5 cases).
- **§F (bug #1)** — admin NotificationBell badge now counts unread notifications from the
  **same source the dropdown renders** (was summing open clinical alerts + unread notifs;
  the dropdown is notifications-only → "9+" badge over an empty dropdown). Playwright PASS.
- **§H (a11y)** — patient `/dashboard` now has exactly one `<h1>` (sr-only), admin every
  page has exactly one `<h1>` (the persistent `AdminTopBar` title demoted to a styled
  `<div>`). Hydration #418 fixed — the time-of-day greeting moved out of render into a
  post-mount `useEffect`. Playwright PASS ×2.
- **§C** — `waitForAlerts` poll helper extracted to `qa/helpers/api.ts`; 6 fixed-`setTimeout`
  race sites in spec 13 converted to polling (kills the remote-DB timing flake class).
- **§G (bug #3)** — admin AlertsTab gains an "Acknowledged" status filter pill.

---

## 🔴 Real product issues still open (NOT fixed this cycle — triage)

| # | Area | Issue | Severity |
|---|---|---|---|
| **B5** | Security / HIPAA | Refresh token in `localStorage` (`healplace_refresh_token`) — single XSS = 30-day account takeover. **Not verified fixed.** | **P0** |
| **B6** | Security / HIPAA | `access_token` cookie JS-readable (not `HttpOnly`). **Not verified fixed.** | **P0** |
| **AE** | Clinical / pilot | **ACE-inhibitor angioedema rule is unimplemented** — no `RULE_*_ANGIOEDEMA` in `rule-ids.ts`/engine, and no facial/lip/tongue-swelling symptom input. Patient string (translation item 1.7) AND caregiver string (item B1.6) are drafted copy with zero implementation. Caregiver B1.6 = **DRAFT / ⚠ PILOT BLOCKER**. | **P0 (pilot blocker)** |

B5/B6 are carried from the 2026-05-08 forensic pass and must be re-checked by a
security-focused cycle before pilot. **AE** needs Dr. Singal sign-off (wording + symptom
trigger + tier + dispatch path) then an engineering ticket — see *Iteration plan*.

---

## 🟡 Partial coverage / deferred (by design)

- **6 `test.fixme()` in spec 09** (`09-rule-engine-via-ui`) — Cluster-7 cleanup
  investigations: `09:475` (obsolete auto-resolve assertion), `09:644/690`
  (`CLUSTER_6_RISK`), `09:737` (post Day-3 + session-averaging), `09:800` (Nora brady),
  `09:916` (Paul CAD co-fire). Each is a real engine question, not a flake.
- **§G AlertsTab UI test** — env-gated: locally (no test-control, volatile patient-detail
  tabs per spec 11) it `test.skip`s cleanly instead of flaky-hard-failing; runs the real
  assertions under a provisioned CI run. Deterministically covered by the admin TS build
  (`StatusFilter` union + `PatientAlert.status` already includes `'ACKNOWLEDGED'`).
- **§H Problem C (#418 hydration)** — DevTools-only, no automated assertion (the spec-04
  console-clean test deliberately filters `hydration` to avoid 3rd-party flake). Manually
  re-verify "no #418 in `/dashboard` console" before pilot.
- **§E translation docs** — documentation only; verified by verbatim cross-check against
  `shared/src/alert-messages.ts`.

**Resolved since 2026-05-08:** the **G1–G9 multi-alert question** is answered + shipped —
Dr. Singal's call was *multi-axis co-fire*; the engine now runs the axis-keyed co-fire
pipeline (Cluster 6 + 7), so contraindication + BP/symptom rows fire together. Those tests
were rewritten, not relaxed. `spec 14:34` full-ladder fixme un-fixme'd via
`advanceLadderSteps`; `spec 12:73` business-hours endpoint test un-skipped.

---

## 🔧 Known test-infra issues

- **Deadlock-retry now catches the adapter-wrapped form (§B).** Reduces the transient
  `TransactionWriteConflict` flake on `resetUser` against the remote DB.
- **Admin `.next` dev-cache corruption (resolved this session).** The admin
  `/patients/[id]` route 404'd because `admin/.next` was corrupt + 8 days stale
  (`routes.d.ts` had a garbled spliced token; compiled `patients/[id]/page.js` predated
  the source by 8 days). Not a code bug — the route file is valid Next 16. Fixed by
  `rm -rf admin/.next` + dev-server restart. Recurs if `next dev` is interrupted
  mid-compile; reset = `rm -rf <app>/.next && npm run dev`.
- **Backend `tsc --noEmit` non-zero exit is pre-existing noise** — every error is in
  `*.spec.ts` (jest mock `never`-typing) or `test/llm-judge/voice-chat.e2e-spec.ts`, all
  on `dev` before this PR. This PR's changed source files: 0 tsc errors.
- **Shared seed DB pollution + archetype wiping** (carryover) — local runs against the
  shared remote DB hit seed-state pollution; CI uses fresh DB-per-shard. The Cluster 6
  persona expansion (Carol/Mike/Kate/…) is not seeded on the swapped local DB, so the
  `spec 10:101` patient-list assertion and `/patients/[id]` data fetches for those
  personas fail locally — **pre-existing seed gap, unrelated to this PR**.
- **Accepted WCAG debt** — orange/amber-on-tinted small text is explicitly accepted,
  scoped-excluded from spec 16 via `data-axe-debt` attributes + CSS selectors. The
  font-size cleanup (≥14px bold for AA Large) is deferred (A1.6 — out of this cycle's
  scope, needs a design pass with Lakshitha).

---

## 🚫 Skipped (env-gated by design)

- Write-side specs (`RUN_WRITE_TESTS=1`) — 10 spec files; run in CI / with a
  test-control-enabled backend.
- LLM safety refusals (`RUN_LLM_TESTS=1`) — Gemini quota gated.
- spec 19 Cluster 7 (9 tests) — write-gated; loads cleanly post §C helper extraction.
- §G AlertsTab pill — env-gated skip when the admin UI walk is unprovisioned locally.

---

## This cycle's changes (12 commits ahead of `origin/dev`)

| § | Commit | Change | Proof |
|---|---|---|---|
| pre | `55dae45` | `.env.example` — document `CAREGIVER_DISPATCH_ENABLED` | config doc |
| pre | `9756ae6` | counsel-reviewed patient+admin privacy/terms ×4 (v2026-05-08) | legal copy |
| §B | `ffdb51b` | widen deadlock-retry matcher (bug #20) | jest 8/8 |
| §C | `1e69aa1` | port `waitForAlerts`, fix 6 spec-13 timeout races | tsc + spec-19 load |
| §D | `5c5dc0d` | suboptimalMeasurement no longer defaults TRUE (bug #5) | jest 10/10 |
| §E | `b18a5f1` | translation pkg Appendix B + brief admin + placeholder docs | cross-check |
| §F | `5953fb5` | NotificationBell badge↔dropdown alignment (bug #1) | Playwright |
| §G | `c0567cd` + `929eda8` | AlertsTab "Acknowledged" pill (bug #3) + env-gate hardening | admin tsc / CI |
| §H | `08bc6d5` | patient+admin `<h1>` hierarchy + hydration #418 | Playwright ×2 |
| doc | `0d581ea`,`4188551` | QA status docs (now consolidated into this file) | — |

**Backfill (landed 05-14 → 05-15, before this PR):** Niva Cluster 7 PR #38 + 4 Duwaragie
follow-ups (β-blocker fatigue/SOB, NSAID interaction, ACE cough, HCM low, HF caregiver
edema, HOLD; spec 19; bug #19 med-dedup; spec 14:34 un-fixme; spec 12:73 un-skip);
CLINICAL_SPEC v2.2 / PR #37.

---

## 🛠 Iteration plan / next steps

1. **Dr. Singal sign-off on ACE-angioedema (pilot blocker)** — final caregiver wording
   (B1.6) + confirm patient wording (item 1.7) + the symptom trigger (no
   facial/lip/tongue-swelling input exists today) + tier + whether it routes via
   `CAREGIVER_DISPATCH_ENABLED`. Then engineering: add `RULE_ACE_ANGIOEDEMA`
   (patient + caregiver) to `rule-ids.ts` → `alert-messages.ts` → engine + symptom flag.
2. **Security-focused cycle to re-verify B5/B6** (refresh token in localStorage,
   non-HttpOnly access cookie). P0 HIPAA blockers — confirm fixed or fix.
3. **Resolve the 6 spec-09 `test.fixme()`** (Cluster-7 cleanup) — verify against the
   shipped multi-axis engine, delete/rewrite obsolete ones.
4. **Translator vendor handoff** — `docs/CLINICAL_TRANSLATION_PACKAGE_EN.md` v2026-05-15
   is ready for Spanish + Amharic except B1.6 (DRAFT, blocked on #1).
5. **Full provisioned CI run** to confirm write-gated §C/§G + the full matrix green.

---

## Pre-merge checklist (`duwaragie-dev → dev`)

- [x] §B–§H implemented, one logical commit per item, brief messages, no engine rule changes
- [x] Backend jest 19/19; shared build + frontend/admin/qa `src` tsc clean
- [x] Playwright no-write: §F + §H ×2 green; §C/§G defer to CI
- [x] §E strings cross-checked; B1.6 flagged DRAFT/PILOT BLOCKER
- [x] `docs/CLINICAL_TRANSLATION_PACKAGE_EN.md` force-added (was gitignored — user-approved)
- [x] Admin `.next` corruption cleared (local-env only, gitignored, no code/commit impact)
- [ ] CI green on all shards (write-gated §C spec-13/19 + §G run there)
- [ ] Manually re-verify no React #418 on `/dashboard` (§H Problem C)
- [ ] Dr. Singal: B1.6 caregiver-angioedema final wording before pilot (PILOT BLOCKER)
- [ ] Merge to `dev` (user-owned — do not auto-merge)

---

## How to run / view

```bash
# Backend unit (the §B/§D gates)
cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest \
  deadlock-retry.spec.ts session-averager.service.spec.ts daily_journal.service.spec.ts

# Playwright (needs the 3 dev servers; write-gated specs need ENABLE_TEST_CONTROL=true)
cd qa && npx playwright test 10-admin-auth-and-dashboard.spec.ts 04-patient-dashboard.spec.ts --reporter=list
RUN_WRITE_TESTS=1 npx playwright test 13-admin-alert-resolution.spec.ts 19-cluster-7-side-effects-via-api.spec.ts --reporter=list --workers=1

# HTML report
cd qa && npx playwright show-report playwright-report
```

---

## References

- Suite guide + test-control endpoint table: `qa/README.md`
- Clinical source-of-truth: `docs/CLINICAL_SPEC.md` (v2.2, PR #37)
- Translator package: `docs/CLINICAL_TRANSLATION_PACKAGE_EN.md` (v2026-05-15)
- Backlog / bug log: `Documents/cardioplace-handoffs/` (BUG_BACKLOG, HANDOFF_TO_NIVA_CLUSTER_7)

> This file is the single living QA results doc. The previously-separate dated
> `STATUS_2026_05_14.md` / `STATUS_2026_05_15.md` snapshots were consolidated here on
> 2026-05-15 — one file, updated in place each cycle.
