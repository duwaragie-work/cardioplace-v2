# Healplace Cardio - QA Testing Guide

**Deployed App Testing**
**Excludes:** Content module, Knowledge Base, OAuth

---

## 1. Authentication (OTP Login)

**Route:** `/sign-in`

| Test Case | Steps | Expected |
|-----------|-------|----------|
| Send OTP | Enter valid email, click Send | "OTP sent" message, 60s resend cooldown |
| Invalid email | Enter bad format | Validation error |
| Resend before cooldown | Click resend within 60s | Button disabled |
| Verify correct OTP | Enter 6-digit code | Redirect to onboarding (first time) or dashboard |
| Verify wrong OTP | Enter incorrect code | "Invalid OTP" error |
| Logout | Profile page > Logout | Redirect to sign-in |

**Endpoints:**
- `POST /api/v2/auth/otp/send` (email)
- `POST /api/v2/auth/otp/verify` (email + OTP + deviceId)
- `POST /api/v2/auth/logout`
- `GET /api/v2/auth/me` (JWT required)

---

## 2. Onboarding

**Route:** `/onboarding` (shown after first login)

| Test Case | Steps | Expected |
|-----------|-------|----------|
| Complete onboarding | Fill name, DOB, communication preference > Continue | Profile saved, redirect to `/dashboard` |
| Skip onboarding | Click Skip | Redirect to dashboard without blocking |
| Empty submission | Leave all fields blank, click Continue | Button disabled |
| DOB validation | Enter future date or >120 years ago | Validation error |

**Endpoints:**
- `POST /api/v2/auth/profile` (marks onboarding COMPLETED)
- `PATCH /api/v2/auth/profile` (partial update)

---

## 3. User Profile

**Route:** `/profile`

| Test Case | Steps | Expected |
|-----------|-------|----------|
| View profile | Navigate to /profile | Shows name, email (verified badge), DOB, timezone, communication preference, primary condition, risk tier, roles |
| Edit profile | Click "Edit Profile" > change fields > Save | Fields updated on reload |
| Cancel edit | Click Edit > change fields > Cancel | Changes reverted |
| Timezone | Change timezone dropdown | Must be valid IANA format (e.g. "America/New_York") |
| Communication preference | Switch between Text/Chat and Audio/Voice | Saved and persisted |

**Endpoints:**
- `GET /api/v2/auth/profile`
- `PATCH /api/v2/auth/profile`

---

## 4. Dashboard

**Route:** `/dashboard`

| Test Case | Steps | Expected |
|-----------|-------|----------|
| No readings | New user, load dashboard | "No readings yet" message with link to check-in |
| With readings | After submitting check-ins | Latest BP (color-coded: Normal/Elevated/Crisis), weight, medication status, alert count |
| Quick links | Click Check-in / Chat / Readings / Notifications | Navigate to correct pages |

---

## 5. Chat / AI Assistant

**Route:** `/chat`

### 5a. Basic Chat

| Test Case | Steps | Expected |
|-----------|-------|----------|
| Send message | Type and send | AI streams response word-by-word |
| New session | Open chat fresh | New sessionId created |
| Session history | Navigate back to existing session | Previous messages displayed |
| Delete session | Delete a chat session | Session and history removed |
| Switch sessions | Click between different sessions | Correct conversation history loads |

### 5b. Check-in via Chat

| Test Case | Steps | Expected |
|-----------|-------|----------|
| Full check-in flow | Say "Record check-in" > answer all questions (date, time, BP, medication, weight, symptoms) | Check-in saved, confirmation card shown |
| Partial submission | Provide only BP, skip medication | AI tool REJECTED with "Missing steps" message, AI asks remaining questions |
| Invalid BP | Provide BP outside range (e.g. systolic > 250) | Validation error |
| Skip optional fields | Say "skip" for weight | Should proceed without weight |

**Chat flow order:** Date > Time > BP (systolic/diastolic) > Medication > Weight > Symptoms > Submit

### 5c. Edit/Delete via Chat

| Test Case | Steps | Expected |
|-----------|-------|----------|
| Edit entry | "Edit my last reading" > change BP | Entry updated |
| Delete entry | "Delete my last reading" | Entry removed after confirmation |
| Get readings | "Show my recent readings" | AI calls `get_recent_readings` and displays them |

### 5d. Emergency Detection

| Test Case | Steps | Expected |
|-----------|-------|----------|
| Emergency phrase | "I'm having severe chest pain right now" | `flag_emergency` tool called, response includes `isEmergency: true`, emergency guidance shown |

**Endpoints:**
- `POST /api/chat/streaming` (SSE stream)
- `POST /api/chat/structured` (JSON response)
- `GET /api/chat/sessions`
- `GET /api/chat/sessions/:sessionId`
- `GET /api/chat/sessions/:sessionId/history`
- `DELETE /api/chat/sessions/:sessionId`

---

## 6. Readings / History

**Route:** `/readings`

| Test Case | Steps | Expected |
|-----------|-------|----------|
| View readings | Navigate to /readings | List of entries sorted newest first, grouped by date |
| Empty state | No entries | "No readings recorded" message |
| Entry details | View entry card | Shows date, time, BP with status badge, weight, medication, symptom count |
| Edit entry | Click pencil icon > modify fields > Save | Changes persisted on reload |
| Delete entry | Click trash icon > confirm | Entry removed from list |
| Multiple per day | Submit 2+ entries same day | Shows "N readings" label |

**Endpoints:**
- `GET /api/daily-journal` (query: startDate, endDate, limit)
- `GET /api/daily-journal/:id`
- `PUT /api/daily-journal/:id`
- `DELETE /api/daily-journal/:id`
- `GET /api/daily-journal/history` (paginated: page, limit)

---

## 7. Baseline & Deviation Detection

### 7a. Baseline Calculation (automatic)

| Test Case | Steps | Expected |
|-----------|-------|----------|
| < 3 days of readings | Submit readings on 1-2 days | No baseline computed |
| 3+ days of readings | Submit readings on 3 different days within 7-day window | Baseline computed (average systolic, diastolic, weight) |
| View baseline | Check baseline endpoint | Returns latest baseline snapshot |

**Logic:** Per-day averaging (average each day's readings, then average across days). Requires >= 3 days with complete BP.

### 7b. Deviation Alerts (automatic)

| Test Case | Steps | Expected |
|-----------|-------|----------|
| BP within normal | Submit BP close to baseline | No deviation alert |
| BP exceeds threshold | Submit BP > baseline + 10 mmHg | Deviation alert created (type: SYSTOLIC_BP or DIASTOLIC_BP, severity: HIGH) |
| Alert resolved | Submit normal BP after deviation | Open alerts resolved automatically |
| Acknowledge alert | Click acknowledge on alert | Status changes to ACKNOWLEDGED |

**Endpoints:**
- `GET /api/daily-journal/baseline/latest`
- `GET /api/daily-journal/alerts`
- `PATCH /api/daily-journal/alerts/:id/acknowledge`

---

## 8. Escalation Logic (automatic)

| Test Case | Steps | Expected |
|-----------|-------|----------|
| < 3 consecutive days elevated | 2 days elevated BP | Log: "below threshold (need 3)" |
| 3 days + no symptoms + taking meds | 3 consecutive days elevated, compliant | LEVEL_1 escalation: "Your BP has been elevated for multiple days" |
| 3 days + symptoms + missed meds | 3 days elevated + headache/chest pain + not taking meds | LEVEL_2 escalation: "IMMEDIATE ACTION REQUIRED" |
| Duplicate escalation | Same alert already escalated | Should NOT escalate again (idempotent) |

**Endpoint:**
- `GET /api/daily-journal/escalations`

---

## 9. Notifications

**Route:** `/notifications`

| Test Case | Steps | Expected |
|-----------|-------|----------|
| No alerts | Load with clean state | "No action needed" message |
| Open alert | Trigger deviation (exceeds baseline) | Alert appears in "Action Required" section |
| Escalated alert | Trigger escalation | Red "ESCALATED" badge on alert |
| Acknowledge alert | Click acknowledge button | Moves to "Past Alerts" section |
| Unread notifications | After escalation triggers notification | Unread badge, purple border, "Tap to read" |
| Read notification | Click notification | Marked as read, badge decrements |
| Mark all read | Click "Mark All Read" | All notifications marked read |
| Tab filters | Switch All / Unread / Read | Filtered list displayed |
| Expand tips | Click notification with tips | Care tips expand/collapse |

**Endpoints:**
- `GET /api/daily-journal/notifications` (query: status=all|unread|read)
- `GET /api/daily-journal/notifications/:id`
- `PATCH /api/daily-journal/notifications/:id/status` (body: watched=boolean)
- `PATCH /api/daily-journal/notifications/bulk-status`

---

## 10. Voice Chat

**WebSocket:** `/voice` namespace

| Test Case | Steps | Expected |
|-----------|-------|----------|
| Connect without token | Open WS without JWT | Disconnect with "Authentication required" |
| Connect with JWT | Open WS with valid token | `session_ready` event received |
| Send audio | Stream audio chunks (PCM 16000Hz, base64) | `transcript` events with speech recognition |
| Voice check-in | Request check-in via voice, answer all questions | `checkin_saved` event with BP/medication data |
| Text fallback | Send `text_input` event | AI processes as text, responds with audio |
| End session | Send `end_session` | Transcript saved to conversation history, `session_closed` event |

**WebSocket Events:**
- Client sends: `start_session`, `audio_chunk`, `text_input`, `end_session`
- Server sends: `session_ready`, `audio_response`, `transcript`, `action`, `checkin_saved`, `session_error`, `session_closed`

---

## 11. Provider Dashboard

**Route:** `/provider/dashboard`
**Access:** Provider role (email: `support@healplace.com`)

| Test Case | Steps | Expected |
|-----------|-------|----------|
| Stats summary | Load provider dashboard | Shows: total patients, monthly interactions, active alerts, readings this month, patients needing attention, BP controlled % |
| Non-provider access | Login as patient, navigate to /provider/* | Access denied or redirect |

**Endpoint:**
- `GET /api/provider/stats`

---

## 12. Provider - Patients

**Route:** `/provider/patients`

| Test Case | Steps | Expected |
|-----------|-------|----------|
| List patients | Load page | All patients with onboarding COMPLETED |
| Filter by risk tier | Select HIGH/ELEVATED/STANDARD | Filtered list |
| Filter by active alerts | Toggle "Has Active Alerts" | Only patients with OPEN alerts |
| Patient detail | Click patient | Modal: name, email, risk tier, latest BP vs baseline, recent entries, active alerts, escalations |
| BP trend | View patient BP trend | Chart with date range filter |

**Endpoints:**
- `GET /api/provider/patients` (query: riskTier?, hasActiveAlerts?)
- `GET /api/provider/patients/:userId/summary`
- `GET /api/provider/patients/:userId/journal` (query: page, limit)
- `GET /api/provider/patients/:userId/bp-trend` (query: startDate, endDate)

---

## 13. Provider - Alerts

| Test Case | Steps | Expected |
|-----------|-------|----------|
| View all alerts | Load alerts view | All patient alerts listed |
| Filter by severity | Select HIGH/MEDIUM/LOW | Filtered list |
| Filter escalated | Toggle escalated filter | Only escalated alerts |
| Alert detail | Click alert | Patient info, reading values, baseline comparison, timeline |
| Acknowledge | Click acknowledge | Alert status ACKNOWLEDGED |

**Endpoints:**
- `GET /api/provider/alerts` (query: severity?, escalated?)
- `GET /api/provider/alerts/:alertId/detail`
- `PATCH /api/provider/alerts/:alertId/acknowledge`

---

## 14. Provider - Scheduled Calls

| Test Case | Steps | Expected |
|-----------|-------|----------|
| List calls | Load scheduled calls | Shows upcoming calls |
| Create call | Click Schedule > select patient, date, time, type, notes | Call created |
| Update status | Change call to completed/missed/cancelled | Status updated |
| Delete call | Delete a scheduled call | Call removed |
| Filter by status | Switch upcoming/completed/missed | Filtered list |

**Endpoints:**
- `GET /api/provider/scheduled-calls` (query: status?)
- `POST /api/provider/schedule-call` (body: patientUserId, alertId?, callDate, callTime, callType, notes)
- `PATCH /api/provider/scheduled-calls/:id/status` (body: status)
- `DELETE /api/provider/scheduled-calls/:id`

---

## Critical Path Checklist

- [ ] OTP login > verify > redirect
- [ ] Onboarding > submit profile > dashboard
- [ ] Chat check-in > all questions asked > saved
- [ ] 3 days of readings > baseline computed
- [ ] BP exceeds baseline > deviation alert created
- [ ] 3 consecutive elevated days + symptoms > escalation triggered
- [ ] Notifications > alerts display > acknowledge > mark read
- [ ] Chat streaming works > emergency detection works
- [ ] Voice connect > audio > transcript > check-in saved
- [ ] Provider dashboard > patients > alerts > schedule call
- [ ] Edit/delete readings from /readings page
- [ ] Edit/delete readings via chat
- [ ] Role-based access (patient vs provider)

---

## Environment Info

- **Auth:** JWT Bearer token in `Authorization` header
- **Headers:** `X-Device-Id`, `X-Timezone` (optional)
- **WebSocket:** Same domain, `/voice` namespace with JWT
