# Cardioplace v2 — Rule-Based BP Alert System

## What this project is

A full pivot from the v1 ML-hybrid BP monitoring prototype (adapted from the Healplace menopause platform) to a **pure rule-based BP alert system** per Dr. Manisha Singal's signed-off clinical specification. Built for the Elevance Health Foundation Patient Safety Prize cohort (Cedar Hill / BridgePoint / AmeriHealth, Ward 7 & 8 DC).

Live v1 app runs at `www.cardioplaceai.com` — this repo (`cardioplace-v2`) is the **rewrite workspace**, cloned from the v1 repo. Do not corrupt the live app.

## Monorepo structure (npm workspaces)

- `/backend`       → NestJS + Prisma + PostgreSQL (shared API for both frontends)
- `/frontend`      → Next.js 14 patient app → app.cardioplaceai.com
- `/admin`         → Next.js 14 admin/provider app → admin.cardioplaceai.com (NEW, being scaffolded in phase/1)
- `/shared`        → npm workspace package: DTOs, enums, alert-message registry (NEW)
- `/adk-service`   → Python voice/Gemini service (untouched in v2)

## Key reference docs (READ FIRST)

- `docs/CLINICAL_SPEC.md` — Dr. Singal's signed-off rule specs (v1.0 + v2.0 addendum). Canonical source of truth for every alert rule, threshold, and escalation tier.
- `docs/ARCHITECTURE.md` — Schema plan (new models + field additions), rule-engine pipeline, escalation ladder, three-tier output contract.
- `docs/BUILD_PLAN.md` — 8-week timeline, phase branches, three-developer role split.
- `docs/DEV3_TASKS.md` — Backend/infra task checklist (the user owns Dev 3).
- `docs/SETUP.md` — Getting started: DB provisioning, env vars, first commands.

Existing legacy v1 docs (`CLINICAL_LOGIC_REVIEW.md`, `HEALPLACE_CARDIO_OVERVIEW.md`, `REMAINING_TASKS_PLAN.md`, `QA_TESTING_GUIDE.md` at repo root and inside `/docs`) are **v1 context only** — do not take as canonical for v2.

## What's reusable from v1 (audit summary)

REUSABLE:
- Schema foundations: `User`, `JournalEntry`, `DeviationAlert`, `EscalationEvent`, `BaselineSnapshot`, `Notification`
- `/backend/src/daily_journal/services/deviation.service.ts` (~287 LOC, already rule-based — needs threshold externalization)
- `/backend/src/daily_journal/services/baseline.service.ts` (~249 LOC — keep for trend charts only, not rule input)
- `/backend/src/daily_journal/services/escalation.service.ts` (~275 LOC, 2-tier — needs T+N ladder expansion)
- `/backend/src/chat/services/system-prompt.service.ts` (~350 LOC — needs expansion to include meds, conditions, verified fields)
- Notification service (push + email, idempotent, event-driven)
- Magic link auth, JWT, role guards

NEEDS BUILD (mostly greenfield):
- `/admin` app (0%)
- `Practice`, `PatientProviderAssignment`, `PatientThreshold`, `PatientMedication`, `ProfileVerificationLog` models
- `AlertEngineService`, `ProfileResolver`, three-tier message registry
- Full 5-step escalation ladder (T+0, T+4h, T+8h, T+24h, T+48h) + 15-field audit trail
- Patient self-report intake UI (card-based medication selection)
- Admin verification workflow + threshold editor + 3-layer dashboard

## v2 highlights vs v1

- **Pure rule-based** alert engine — no ML model
- **Patient self-reports** clinical profile + medications; provider verifies within 48–72h ("trust then verify")
- **Admin portal split** — separate Next.js app on a separate subdomain, so admins and patients can test concurrently without logout-login churn
- **Multi-practice** support via `Practice` + `PatientProviderAssignment`
- **Three-tier output**: every alert produces patient text, caregiver text, physician text
- **Joint Commission-compliant audit trail**: 15 fields per escalation event

## Tech stack

- Backend: NestJS, Prisma, PostgreSQL, `@nestjs/schedule` for cron, event-driven pipeline
- Frontend + Admin: **Next.js 16** App Router, Tailwind CSS v4, TypeScript, React 19
- Auth: JWT + magic link
- Chat: Gemini 3.1 (text), Piper TTS (voice, via adk-service)
- Monorepo: **npm workspaces** (npm 7+, native support — chosen over pnpm for lower risk)

### Next.js 16 notes

- Route guards live in `src/proxy.ts` (not `src/middleware.ts`). Export a `proxy()` function — `middleware()` is deprecated in Next 16.
- `turbopack.root` must be absolute and point at the monorepo root so Turbopack can resolve hoisted `node_modules`.
- Frontend dep (`next 16.2.1`) is locked; admin matches. When in doubt, read `node_modules/next/dist/docs/` before writing Next-specific code.

### Local ports

| Service | Port | URL |
|---|---|---|
| Backend (NestJS) | **4000** | http://localhost:4000 |
| Patient frontend (Next.js) | **3000** | http://localhost:3000 |
| Admin app (Next.js) | **3001** | http://localhost:3001 |
| ADK voice service (Python) | 50051 | grpc://localhost:50051 |

All three workspaces ship a `.env.example` — copy to `.env` / `.env.local` and fill in secrets.

## Build phases (branch naming: `phase/N-description`)

All work happens on phase branches. Never commit to `main` or `dev` directly.

| # | Branch | Owner | Summary |
|---|---|---|---|
| 0 | `phase/0-bootstrap` | Dev 3 | This context bootstrap — CLAUDE.md + docs + memory seed |
| 1 | `phase/1-monorepo-setup` | Dev 3 | npm workspaces, `/shared` package, `/admin` scaffold |
| 1b | `phase/1b-port-provider-pages` | Dev 3 | Port provider UI from `/frontend` to `/admin`, frontend SUPER_ADMIN redirect, env examples, port allocation |
| 2 | `phase/2-rule-based-schema` | Dev 3 | Single Prisma migration for all v2 models |
| 3 | `phase/3-patient-intake-api` | Dev 3 | Self-report endpoints, `PatientMedication` CRUD |
| 4 | `phase/4-profile-resolver` | Dev 2 | Safety-net logic, unverified handling |
| 5 | `phase/5-alert-engine` | Dev 2 | Rule pipeline (standard + personalized modes) |
| 6 | `phase/6-three-tier-messages` | Dev 2 | Message registry + OutputGenerator |
| 7 | `phase/7-escalation-ladder` | Dev 3 | T+N cron + 15-field audit |
| 8 | `phase/8-admin-shell` | Dev 1 | Admin app auth, layout, patient list |
| 9 | `phase/9-admin-verification` | Dev 1 | Profile confirm/correct UI |
| 10 | `phase/10-admin-thresholds` | Dev 1 | `PatientThreshold` editor |
| 11 | `phase/11-admin-dashboard-3layer` | Dev 1 | Red/yellow/green alert panel |
| 12 | `phase/12-admin-reconciliation` | Dev 1 | Medication side-by-side view (data model only for MVP) |
| 13 | `phase/13-practice-config` | Dev 3 | `Practice` model, business hours, backup assignment |
| 14 | `phase/14-patient-intake-ui` | Dev 1 | Card-based medication + condition intake |
| 15 | `phase/15-patient-check-in-v2` | Dev 1 | Pulse, checklist, structured symptoms |
| 16 | `phase/16-chat-system-prompt-v2` | Dev 2 | Chat system prompt rewrite for new schema |
| 17 | `phase/17-crons` | Dev 3 | Gap alerts, monthly re-ask, escalation reminders |
| 18 | `phase/18-integration-tests` | all | E2E + rule coverage |
| 19 | `phase/19-seed-data` | Dev 3 | Medication catalog, demo patients, practices |
| 20 | `phase/20-prod-deploy` | Dev 3 | Production cutover (deferred until ready) |

Dev roles (see `docs/BUILD_PLAN.md` for detail):
- Dev 1 — Frontend (patient + admin apps)
- Dev 2 — Rule engine + chat
- Dev 3 — Backend infra + monorepo glue (**user**)

## Rules for AI

- Always work on a `phase/N-description` branch, never `main` or `dev`
- Backend changes: `cd backend` first
- Frontend changes: `cd frontend` first
- Admin changes: `cd admin` first
- After schema changes always run: `cd backend && npx prisma migrate dev && npx prisma generate`
- Never run manual SQL — use Prisma migration files
- Shared types live in `/shared` — never duplicate across apps
- Commit messages: one short line, no body, no `Co-Authored-By` lines
- `SUPER_ADMIN` role only accesses `/admin` app — no patient-facing pages
- Three-tier alert messages live in `/shared/alert-messages.ts` — single source of truth
- `/frontend` is patient-only. `/admin` is provider/care-team only.
- Don't touch `/adk-service` (Python voice service) unless the chat integration requires it
- Live production app is at `www.cardioplaceai.com` (v1) — this repo targets separate domains and a separate database

## Clinical authority

Dr. Manisha Singal owns every clinical decision. Rule thresholds, three-tier message wording, symptom trigger lists, and medication contraindication logic all require her sign-off. See `docs/CLINICAL_SPEC.md` for what's already signed off.
