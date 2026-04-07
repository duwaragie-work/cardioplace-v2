# Healplace Cardio — Technical Implementation Overview

**Last updated:** April 3, 2026
**Status:** Feature-complete, demo-ready for Elevance Health Foundation Patient Safety Prize

---

## Architecture at a Glance

| Layer | Technology |
|-------|-----------|
| Backend | NestJS (TypeScript) + Prisma ORM + PostgreSQL |
| Frontend | Next.js 14 (App Router) + Tailwind CSS + Framer Motion |
| AI / LLM | Mistral AI + LangChain + pgvector RAG |
| Real-time | Socket.io WebSocket + gRPC (voice) |
| Auth | JWT (15min) + OTP email + Refresh tokens (30d) |
| Email | Resend |
| Deployment | Railway (backend + DB + voice) + Vercel (frontend) |

---

## Part 1: Backend (9 Modules)

### Module Overview

| Module | Purpose | Endpoints |
|--------|---------|-----------|
| `auth/` | OTP email auth, JWT, refresh tokens, device tracking, RBAC | 12 |
| `daily_journal/` | Check-in pipeline, baseline, deviation, escalation, notifications | 14 |
| `chat/` | AI text chat — Mistral LLM, RAG, emergency detection, journal tools | 6 |
| `voice/` | Real-time voice via WebSocket + gRPC bridge to ADK service | WebSocket |
| `provider/` | Care team dashboard — patients, alerts, calls, stats | 11 |
| `users/` | User profile CRUD | 1 |
| `email/` | Outbound email (OTP, alerts, call scheduling) | Service |
| `mistral/` | LLM configuration wrapper | Service |
| `prisma/` | Database ORM singleton | Service |

### Database Schema

**Identity:** User, Device, UserDevice, RefreshToken, OtpCode, AuthLog
**Clinical:** JournalEntry, BaselineSnapshot, DeviationAlert, EscalationEvent, ScheduledCall, Notification
**Knowledge:** Document, DocumentVector (pgvector embeddings)
**AI:** Conversation, Session, EmergencyEvent

**Key Enums:** UserRole (11 roles), RiskTier (3), DeviationType (4), DeviationSeverity (3), EscalationLevel (2), NotificationChannel (3)

### Event Pipeline

Every patient check-in triggers an asynchronous cascade via `@nestjs/event-emitter`:

```
ENTRY_CREATED → BASELINE_COMPUTED → DEVIATION_DETECTED → ESCALATION_CREATED → NOTIFICATION_SENT
```

- **Baseline:** 7-day rolling average (min 3 entries)
- **Deviation:** Absolute thresholds (180/110 HIGH, 160/100 MEDIUM) + relative thresholds (+20 systolic, +15 diastolic above personal baseline)
- **Escalation:** 3 consecutive days of same deviation type → L1 (24hr) or L2 (immediate)
- **Notification:** In-app + email with personalized health tips

### Auth System
- OTP email (60s cooldown, 5-attempt lockout, 10min TTL)
- JWT access tokens (15min) + refresh token rotation (30d)
- Device tracking (platform, user agent, last seen)
- Role-based access control (11 roles, `@Roles()` decorator)
- Audit logging (every auth event with IP, device, success/failure)

### AI & Voice
- **Text Chat:** Mistral LLM with dynamic system prompt (patient name, baseline, readings, alerts, medications, language). RAG retrieval from pgvector knowledge base. Emergency detection classifier. Tool integration for creating journal entries from conversation.
- **Voice Chat:** Socket.io WebSocket gateway (`/voice` namespace) with JWT auth. gRPC bridge to Python ADK service. Real-time transcription (2s intervals). AudioBuffer queue playback. Full conversation persistence.

### Seed Data
- 1 provider (Dr. Manisha Patel, SUPER_ADMIN)
- 8 patients (varied risk tiers, DC Ward 7/8, EN/ES languages, TEXT_FIRST/AUDIO_FIRST)
- 90 days of journal entries per patient
- Baseline snapshots, deviation alerts, escalation events
- Notifications, scheduled calls, chat conversations

---

## Part 2: Frontend (13 Pages, 14 Components)

### Application Routes

#### Public
| Route | Page |
|-------|------|
| `/` | Landing page — hero, features grid, how it works, CTA |
| `/register` | OTP email registration |
| `/welcome` | Post-registration welcome |
| `/about` | About page |

#### Patient (auth required)

| Route | Page |
|-------|------|
| `/dashboard` | Home — readings, alerts, stats, 7-day BP trend chart |
| `/check-in` | 5-step vitals form (date → BP → weight → medication → symptoms) |
| `/chat` | AI assistant (text + voice modes, session history) |
| `/readings` | Historical BP/weight log with charts |
| `/notifications` | Alert feed with filtering and bulk actions |
| `/profile` | Settings, preferences, communication mode |
| `/onboarding` | 3-step intake (name, DoB, communication preference) |

#### Provider (SUPER_ADMIN)
| Route | Page |
|-------|------|
| `/provider/dashboard` | Analytics — patient KPIs, alert overview, interaction counts |
| `/provider/patients` | Patient roster — filterable by risk tier, active alerts |
| `/provider/scheduled-calls` | Call management — upcoming, completed, missed |

### Key Components

| Component | Highlights |
|-----------|-----------|
| `CheckIn.tsx` | Progressive 5-step form, Framer Motion progress bar, recent readings sidebar, baseline comparison |
| `Dashboard.tsx` | Recharts 7-day BP trend, active alerts, stats (streak, adherence %), quick actions |
| `AIChatInterface.tsx` | Multi-turn chat, markdown rendering, session sidebar, voice/text toggle, tool results |
| `VoiceChat.tsx` | Animated orb, sound wave visualization, 16kHz PCM capture, AudioBuffer playback queue |
| `ProviderDashboard.tsx` | Live stats from API, alert severity breakdown, interaction timeline |
| `Navbar.tsx` | Role-based menu (patient vs provider), language selector, profile dropdown |
| `Homepage.tsx` | Hero section, feature cards, how-it-works steps, multilingual |
| `AlertPanel.tsx` | Severity badges, trend indicators, acknowledge actions |
| `ScheduleModal.tsx` | Provider call scheduling with email notification |

### Internationalization — 5 Languages

| Language | Locale | Coverage |
|----------|--------|----------|
| English | `en` | Full |
| Spanish | `es` | Full |
| Amharic | `am` | Full |
| French | `fr` | Full |
| German | `de` | Full |

- `LanguageContext.tsx` provides `t()` helper with English fallback
- Namespace-based translation keys in `src/i18n/`
- Voice chat language matches user preference
- Language selector in navbar

### Voice System

| Stage | Technology |
|-------|-----------|
| Capture | Web Audio API, `getUserMedia()`, 16kHz |
| Encoding | 16-bit PCM → Base64 via ScriptProcessorNode |
| Transport | Socket.io WebSocket to `/voice` namespace |
| Processing | gRPC bridge to ADK Python service |
| Playback | AudioBuffer queue with state machine |
| Hook | `useVoiceSession.ts` — full lifecycle management |

---

## Part 3: Data Flow

### 1. Authentication
1. User submits email → OTP sent via Resend
2. OTP verified → JWT (15min) + refresh token (30d) issued
3. All API calls use `Authorization: Bearer` header
4. Role-based guards separate patient / provider routes

### 2. Daily Check-In
1. Patient completes 5-step form → `POST /api/daily-journal`
2. Entry saved to PostgreSQL
3. `ENTRY_CREATED` event emitted

### 3. Clinical Pipeline (async, event-driven)
1. **Baseline:** Query last 7 days → compute rolling average → emit `BASELINE_COMPUTED`
2. **Deviation:** Compare reading vs absolute + relative thresholds → create alert if exceeded → emit `DEVIATION_DETECTED`
3. **Escalation:** Check for 3 consecutive days → route to L1 or L2 → emit `ESCALATION_CREATED`
4. **Notification:** Send in-app + email alerts with personalized health tips

### 4. AI Chat
1. User sends message → backend assembles patient context (baseline, readings, alerts, meds)
2. Emergency classifier checks for urgent situations
3. RAG retrieves relevant documents from knowledge base
4. Mistral LLM generates personalized response
5. AI can create/update journal entries via tool integration

### 5. Voice
1. Frontend captures mic audio at 16kHz → Base64 PCM chunks
2. WebSocket streams to backend `/voice` namespace
3. gRPC bridge forwards to ADK service for transcription + response
4. Agent audio streamed back → AudioBuffer queue playback
5. Conversation persisted with speaker attribution

---

## Part 4: Deployment

| Component | Platform | Configuration |
|-----------|----------|--------------|
| Backend | Railway | Docker container, port 8080 |
| Frontend | Vercel | Auto-deploy, `NEXT_PUBLIC_API_URL` |
| Database | Railway PostgreSQL | Prisma migrations + seed |
| ADK Voice | Railway | gRPC on private network (port 50051) |

### Key Environment Variables
- **Backend:** `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `MISTRAL_API_KEY`, `SMTP_*` (Resend), `ADK_SERVICE_HOST/PORT`
- **Frontend:** `NEXT_PUBLIC_API_URL`

---

## Feature Completion Summary

| Category | Features | Status |
|----------|----------|--------|
| Authentication | OTP email, JWT, refresh rotation, device tracking, RBAC | Complete |
| Patient Check-In | 5-step form, validation, event pipeline | Complete |
| Clinical Logic | Baseline, deviation, escalation, notifications | Complete |
| AI Chat | Mistral LLM, RAG, emergency detection, journal tools | Complete |
| Voice Chat | WebSocket, gRPC, transcription, audio playback | Complete |
| Provider Dashboard | Stats, patient roster, alerts, scheduled calls | Complete |
| Internationalization | 5 languages, context provider, voice integration | Complete |
| Landing & Onboarding | Homepage, about, welcome, 3-step onboarding | Complete |
| Seed Data | 8 patients, 90 days, alerts, escalations, conversations | Complete |
| Deployment | Docker, Railway, Vercel configs | Complete |

---

*Healplace Cardio is a production-grade cardiovascular monitoring platform — feature-complete and demo-ready.*
