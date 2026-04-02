# Healplace Cardio — Technical Implementation Overview

This document outlines the current state of the Backend and Frontend implementations for the Elevance Health Foundation Patient Safety Prize prototype, along with a detailed breakdown of the application's data flow.

**Last updated:** April 2, 2026

---

## Part 1: Backend Implementation

### 1. Architecture Overview
*   **Framework:** NestJS (TypeScript)
*   **Database:** PostgreSQL via Prisma ORM (20+ schema models)
*   **Real-time:** Socket.io WebSocket gateway for voice streaming
*   **LLM:** Mistral AI with RAG (LangChain orchestration)
*   **Email:** Resend for outbound notifications
*   **Auth:** JWT + OTP email verification
*   **Deployment:** Railway (Docker container)

### 2. Backend Modules
| Module | Purpose |
|---|---|
| `auth/` | Authentication (JWT + OTP email verification), role-based guards |
| `provider/` | Provider dashboard — patients, alerts, journal history, scheduled calls (10+ endpoints) |
| `daily_journal/` | Check-in pipeline — entry creation, baseline computation, deviation detection, escalation routing |
| `chat/` | AI text chat — Mistral LLM with RAG, emergency detection, journal tool integration |
| `voice/` | Real-time voice conversations via WebSocket + gRPC bridge to ADK voice service |
| `mistral/` | LLM orchestration and prompt management |
| `content/` | *(Future)* Educational content library — articles and resources surfaced in chat |
| `knowledgebase/` | *(Future)* RAG document storage and retrieval with vector search (pgvector) |
| `users/` | User profile CRUD and account management |
| `email/` | Outbound email via Resend (call scheduling notifications, alerts) |

### 3. Core Event Pipeline
The cardiovascular monitoring uses an event-driven sequence triggered every time a patient logs their vitals. The pipeline flows via `@nestjs/event-emitter`:

`ENTRY_CREATED` ➔ `BASELINE_COMPUTED` ➔ `DEVIATION_DETECTED` ➔ `ESCALATION_CREATED`

*   **Data Ingestion & Baseline:** 7-day rolling average algorithm for Systolic/Diastolic BP.
*   **Deviation Detection:** Evaluates against absolute clinical thresholds and relative baseline thresholds. Checks `SYSTOLIC_BP`, `DIASTOLIC_BP`, `WEIGHT`, and `MEDICATION_ADHERENCE`.
*   **Escalation Routing:** Triggers when deviations occur consecutively (3+ in 3 days). Level 1 = 24hr care team alert. Level 2 = immediate intervention/911.

### 4. Provider API Endpoints
| Method | Path | Description |
|---|---|---|
| GET | `/provider/stats` | Dashboard metrics (patients, interactions, alerts, BP control %) |
| GET | `/provider/patients` | Filtered patient list (risk tier, active alerts) |
| GET | `/provider/patients/:userId/summary` | Full patient profile + recent entries + alerts + escalations |
| GET | `/provider/patients/:userId/journal` | Paginated journal history with baseline comparisons |
| GET | `/provider/alerts` | All open alerts with severity sorting |
| GET | `/provider/alerts/:alertId/detail` | Rich alert context (BP trend, trigger reasons, AI summary) |
| PATCH | `/provider/alerts/:alertId/acknowledge` | Mark alert as reviewed |
| GET | `/provider/scheduled-calls` | Scheduled follow-up calls |
| POST | `/provider/schedule-call` | Create follow-up (sends email notification) |
| PATCH | `/provider/scheduled-calls/:id/status` | Update call status |
| DELETE | `/provider/scheduled-calls/:id` | Cancel scheduled call |

### 5. AI & Voice Architecture
*   **Text Chat:** Mistral LLM with patient health context injection. Emergency detection service classifies critical situations and routes to specialized response chains. Tool integration allows the AI to create journal entries directly from conversation.
*   **Voice Chat:** WebSocket gateway (Socket.io `/voice` namespace) with JWT auth. gRPC bridge to ADK audio/speech service. Real-time transcription every 2 seconds with parallel user/agent audio buffering and conversation persistence.
*   **Future — Knowledge Base RAG:** The `content/` and `knowledgebase/` modules are scaffolded for a future content library. This will inject relevant articles, educational resources, and clinical guidelines into chat responses via vector similarity search (pgvector), giving the AI chatbot the ability to recommend specific reading materials and resources to patients.

### 6. Seed Data
Comprehensive demo dataset created via `prisma/seed.ts`:
*   **1 provider/admin:** Dr. Manisha Patel (SUPER_ADMIN)
*   **8 patients** with varied profiles:
    *   Mix of risk tiers (STANDARD, ELEVATED, HIGH)
    *   DC Ward 7/8 demographics
    *   Healthcare worker patients (Cedar Hill nurse, hospital staff)
    *   BridgePoint post-discharge patient
    *   Spanish-speaking patient (Maria Santos)
    *   Audio-first and text-first communication preferences
*   **90 days of journal entries** per patient with realistic BP variance, crisis days, and medication compliance
*   **Baseline snapshots** computed every 7 days
*   **Deviation alerts** (OPEN, ACKNOWLEDGED, RESOLVED) with escalation events (L1/L2)
*   **Notifications**, **scheduled calls**, and **chat conversation history**

---

## Part 2: Frontend Implementation

### 1. Architecture Overview
*   **Framework:** Next.js 14 (App Router, TypeScript)
*   **Styling:** Tailwind CSS + Framer Motion animations
*   **Icons:** Lucide React
*   **Role:** Mobile-responsive web app for patient check-ins, AI chat, voice interactions, and the provider care team portal.
*   **Deployment:** Vercel

### 2. Application Routes
| Route | Purpose |
|---|---|
| `/` | Welcome / landing page |
| `/register` | OTP registration flow |
| `/auth/callback` | OAuth callback handler (Google/Apple) |
| `/onboarding` | Patient intake and setup |
| `/dashboard` | Patient home — recent readings, alerts, quick actions (auto-redirects providers) |
| `/check-in` | Daily vitals form (5-step: date → BP → weight → medication → symptoms) |
| `/chat` | AI text chat interface with session history |
| `/readings` | Historical BP/weight log |
| `/profile` | Patient settings and preferences |
| `/notifications` | Alert feed |
| `/provider/dashboard` | Provider analytics — patient KPIs, alert overview, interaction counts |
| `/provider/patients` | Patient roster with detail modals, filtering by risk tier and alerts |
| `/provider/scheduled-calls` | Call management — upcoming, completed, missed |

### 3. Key Components (`components/cardio/`)
| Component | Description |
|---|---|
| `CheckIn.tsx` | 5-step progressive form with visual progress bar, recent readings sidebar, baseline comparison, medication adherence tracking, symptom multi-select |
| `AIChatInterface.tsx` | Multi-turn text chat with session history, markdown rendering, voice/text toggle, tool result display |
| `VoiceChat.tsx` | Voice-first UI with animated orb, sound wave visualization, real-time transcription. Uses Web Audio API for mic capture, 16-bit PCM encoding, Socket.io streaming |
| `Dashboard.tsx` | Patient home with recent readings, active alerts, quick action cards |
| `ProviderDashboard.tsx` | Provider analytics pulling live data from backend API — patient stats, alert severity breakdown, interaction counts |
| `AlertPanel.tsx` | Alert rendering with severity badges, acknowledgment actions |
| `ScheduleModal.tsx` | Call scheduling interface for providers |
| `Navbar.tsx` | Navigation with role-based menu (patients vs. providers see different links) |
| `Welcome.tsx` | Onboarding welcome screen |

### 4. Voice System (Fully Functional)
*   **Connection:** Socket.io client to backend `/voice` namespace with JWT auth
*   **Capture:** Web Audio API (`getUserMedia`) at 16kHz sample rate
*   **Encoding:** Real-time 16-bit PCM via `ScriptProcessorNode`
*   **Transport:** Base64 audio chunks streamed over WebSocket
*   **Playback:** AudioBuffer queue for agent responses with state machine (idle → connecting → ready → listening → processing → agent_speaking)
*   **Hook:** `useVoiceSession.ts` manages the full lifecycle

### 5. Internationalization (Fully Functional)
*   **Context:** `LanguageContext.tsx` provides i18n state from user profile `preferredLanguage`
*   **Locales:** 5 complete — English, Spanish, Amharic, French, German
*   **Structure:** Namespace-based translation keys in `src/i18n/` with English fallback
*   **Voice integration:** TTS/STT language attribute matches user's `preferredLanguage`

### 6. API Services (`services/`)
| Service | Backend endpoints covered |
|---|---|
| `auth.service.ts` | Login, OTP verification, token refresh |
| `journal.service.ts` | Check-in creation/updates, baseline retrieval |
| `chat.service.ts` | Text chat messages, session history, tool results |
| `provider.service.ts` | Patient list, alerts, call scheduling |

---

## Part 3: Data & Event Flow

### 1. Authentication & Intake
1.  **Auth Module:** User signs up or logs in via OTP email verification. Backend issues a JWT (access: 15min, refresh: 30 days).
2.  **User Context:** JWT passed in `Authorization: Bearer` header for all API calls. Role-based guards separate patient and provider routes.
3.  **Onboarding:** Patient submits medical history (CVD risk, communication preferences, baseline info) to instantiate their record.

### 2. Daily Check-In Workflow
When a patient logs daily metrics from the `/check-in` page:

1.  **Gateway:** Request hits `daily_journal` controller. Payload validated via DTOs against the Cardio Prisma schema.
2.  **Entry Creation:** New log saved to PostgreSQL.
3.  **Event Emitted:** System emits `JOURNAL_EVENTS.ENTRY_CREATED` via `EventEmitter2`.

### 3. Cascading Event Pipeline
Executes asynchronously via decoupled listener services:

1.  **Phase A — Baseline Computation (`baseline.service.ts`):** Listens to `ENTRY_CREATED`. Queries last 7 days of BP logs. Recalculates moving average. Emits `BASELINE_COMPUTED`.

2.  **Phase B — Deviation Detection (`deviation.service.ts`):** Listens to `BASELINE_COMPUTED`. Compares new reading against absolute thresholds (e.g., Systolic >180) and relative thresholds (e.g., >20% above personal baseline). Logs anomaly record. Emits `ANOMALY_TRACKED`.

3.  **Phase C — Escalation Routing (`escalation.service.ts`):** Listens to `ANOMALY_TRACKED`. Checks if this is the 3rd occurrence in 3 days. `LEVEL_1`: 24-hour care team SLA. `LEVEL_2`: Immediate intervention/911 for HIGH severity or emergency symptoms.

### 4. AI Text Chat Flow
1.  **Request:** User sends query to chat endpoint.
2.  **Context Assembly:** Backend queries latest check-in data, computed baselines, active L1/L2 alerts, and demographic context (language, preferences).
3.  **Emergency Classification:** Messages are classified for urgency. Critical situations trigger specialized response chains.
4.  **LLM Execution:** Packaged prompt sent to Mistral LLM. Response is personalized and medically contextual.
5.  **Tool Integration:** AI can invoke journal tools to create check-in entries directly from conversation.
6.  **Future — Resource Recommendations:** Knowledge base RAG will retrieve relevant articles and educational resources via vector similarity search, allowing the chatbot to suggest reading materials alongside its responses.

### 5. Voice Chat Flow
1.  **Connection:** Patient opens voice mode. Frontend establishes Socket.io WebSocket to `/voice` namespace with JWT auth.
2.  **Audio Capture:** Web Audio API captures microphone at 16kHz. `ScriptProcessorNode` encodes to 16-bit PCM.
3.  **Streaming:** Audio chunks Base64-encoded and sent to backend via WebSocket.
4.  **Backend Processing:** gRPC bridge forwards audio to ADK voice service for transcription and response generation.
5.  **Response:** Agent audio streamed back. Frontend decodes and plays via AudioBuffer queue. Real-time transcript displayed.
6.  **Persistence:** Conversation history saved to database with speaker attribution (user/agent).

---

## Part 4: Deployment

| Component | Platform | Configuration |
|---|---|---|
| Backend | Railway | Docker container, root directory: `/backend` |
| Frontend | Vercel | Root directory: `/frontend`, `NEXT_PUBLIC_API_URL` env var |
| Database | Railway PostgreSQL | Prisma migrations + seed on deploy |

### Environment Variables
*   **Backend:** `DATABASE_URL`, `JWT_SECRET`, `MISTRAL_API_KEY`, `RESEND_API_KEY`
*   **Frontend:** `NEXT_PUBLIC_API_URL`

---

## Tech Stack Summary

| Layer | Technology |
|---|---|
| Backend Framework | NestJS (TypeScript) |
| Database | PostgreSQL + Prisma ORM |
| LLM | Mistral AI + LangChain |
| Real-time | Socket.io + gRPC |
| Frontend Framework | Next.js 14 (App Router, TypeScript) |
| Styling | Tailwind CSS + Framer Motion |
| Auth | JWT + OTP email verification |
| Audio | Web Audio API + Socket.io streaming + 16-bit PCM |
| Email | Resend |
| Deployment | Railway (backend) + Vercel (frontend) |
