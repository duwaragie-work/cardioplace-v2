# Healplace Cardio — Remaining Tasks Plan

## Context

The prototype is nearly complete. The Elevance Health Safety Prize submission deadline is **April 7, 2026** (11 days away). A team meeting on March 24 established key strategic shifts that affect what the demo needs to show:

- **Metrics = interactions, not just patient count** — 300 patients × 4+ interactions/month = 1,200+ monthly interactions
- **Sustainability via RPM billing** — must demonstrate self-funding beyond the prize
- **Clinical partners** — Cedar Hill, BridgePoint, AmeriHealth, Ward 7 & 8 focus
- **Product must look mature** — not early-stage, but ready to scale
- **Target populations** — cardiac patients + family members + healthcare workers (nurses)

---

## Meeting Takeaways → Implementation Impact

| Meeting Decision | What It Means for the App |
|---|---|
| Shift to "interactions" metric | Seed data should generate realistic interaction volumes; provider dashboard should surface interaction counts |
| RPM billing codes (2-15/month) | Check-in frequency aligns with billing tiers — seed data should reflect this |
| Cedar Hill / BridgePoint / Ward 7&8 | Seed patients should have DC zip codes (20019, 20020, etc.) |
| Healthcare workers as patients | Include nurse/staff demo patients in seed |
| Demo needed by ~Friday | Seed data + provider pages are demo-critical |
| Product looks mature, not in-dev | All pages should be functional, no placeholder text |

---

## Remaining Tasks (Priority Order)

### Task 1: Seed Data (Demo-Critical)
**Files:** `backend/prisma/seed.ts` (new), `backend/package.json` (add seed script)

Create realistic demo data:
- **6-8 demo patients** with varied profiles:
  - Mix of risk tiers (LOW, MEDIUM, HIGH)
  - DC Ward 7/8 zip codes (20019, 20020)
  - Mix of communication preferences (TEXT_FIRST, AUDIO_FIRST)
  - Include 1-2 healthcare worker patients (nurses)
  - EN and ES language preferences
- **30-60 journal entries** per patient (7-14 days of check-ins, some with multiple daily)
- **Baseline snapshots** computed from journal data
- **Deviation alerts** (some OPEN, some ACKNOWLEDGED, some RESOLVED)
- **Escalation events** (L1 and L2 examples)
- **Notifications** linked to alerts
- **Chat conversations** (sample exchanges)
- **1 provider/admin user** (SUPER_ADMIN role)

### Task 2: Provider Dashboard — Patients List Page
**Files:** `frontend/src/app/provider/patients/page.tsx` (new), `frontend/src/components/cardio/PatientsList.tsx` (new)

Dedicated page showing all patients in a filterable list:
- Cards or table rows with: name, risk tier badge, last BP reading, last check-in date, active alerts count
- Filters: risk tier, has active alerts
- Click through to patient detail/alert panel
- Backend endpoint already exists: `GET /provider/patients`

### Task 3: Provider Dashboard — Scheduled Calls Page
**Files:** `frontend/src/app/provider/scheduled-calls/page.tsx` (new), `frontend/src/components/cardio/ScheduledCalls.tsx` (new), possibly `backend/src/provider/provider.service.ts` (add query endpoint)

Cards showing scheduled follow-up calls:
- Patient name, scheduled time, reason/alert context
- Status indicator (upcoming, completed, missed)
- Backend: may need a new endpoint to query alerts with `followUpScheduledAt` set, or query notifications of type schedule

### Task 4: Audio Mode (Real Web Speech API)
**Files:** `frontend/src/components/cardio/CheckIn.tsx`, `frontend/src/components/cardio/AIChatInterface.tsx`, new `frontend/src/hooks/useSpeech.ts`

**TTS (Text-to-Speech):**
- Read check-in questions aloud when audio mode is active
- Read AI chat responses aloud
- Use `window.speechSynthesis` API

**STT (Speech-to-Text):**
- Mic button on check-in BP/weight inputs
- Mic button on chat input
- Use `webkitSpeechRecognition` / `SpeechRecognition` API

**Scope:** Chat + Check-in flow. Triggered by user's `communicationPreference === 'AUDIO_FIRST'` or manual toggle.

### Task 5: Language Preference (EN/ES Toggle)
**Files:** `frontend/src/contexts/LanguageContext.tsx` (new), `frontend/src/i18n/` (new), update key components

Lightweight i18n:
- Create EN/ES string maps for check-in questions, dashboard labels, chat placeholder text
- Language context provider reading from user profile `preferredLanguage`
- Toggle in navbar or profile
- TTS should use matching `lang` attribute (`es-ES` / `en-US`)

### Task 6: Deployment
- **Backend → Railway** (root directory: `backend`)
- **Frontend → Vercel** (root directory: `frontend`)
- Environment variables setup
- Prisma migrate + seed on Railway

---

## Suggested Execution Order

| # | Task | Estimated Effort | Notes |
|---|---|---|---|
| 1 | **Seed data** | ~2-3h | Demo-critical. Everything else needs demo data to look right |
| 2 | **Provider pages** (patients list + scheduled calls) | ~3-4h | Backend endpoints exist. Just need frontend pages with cards |
| 3 | **Audio mode** (Web Speech API) | ~2-3h | TTS on check-in questions + chat responses. STT mic button on check-in inputs + chat |
| 4 | **Language toggle** (EN/ES) | ~2h | Lightweight string maps, no heavy i18n library needed |
| 5 | **Deploy** | ~1-2h | Backend→Railway, Frontend→Vercel, run migrate+seed |

---

## Key Meeting Takeaways Summary

1. **Metrics shift to "interactions"** — Don't just count 300 patients. Each patient has 4-15 system interactions/month (voice + data inputs). Provider dashboard should surface interaction counts, not just patient headcount. Aligns with new Medicare RPM billing codes.

2. **Demo must look mature** — Manisha told the team a demo could be ready by Friday. The judges will penalize anything that looks early-stage. Seed data and fully functional provider pages are critical.

3. **DC Wards 7 & 8 focus** — Seed patients should use real DC zip codes (20019, 20020). Partners are Cedar Hill, BridgePoint, AmeriHealth.

4. **Expanded target population** — Include healthcare workers (nurses) as demo patients, not just cardiac patients. Family engagement angle too.

5. **RPM billing = sustainability story** — The platform's self-funding argument rests on CMS billing codes for 2-15 interactions/month. Check-in frequency already aligns.

6. **Quality improvement, not clinical trial** — Framing matters. Patient safety methodology + human factors engineering focus.

7. **90-second video** — Led by Manisha as clinician/DCHA board member. iPhone recording acceptable.

8. **Lead organization** — DCHA, with Manisha as board member. No conflict of interest issues if properly noted.

---

## Audio Mode Scope Detail

Audio covers **both check-in and chat**:
- **Check-in:** TTS reads questions aloud ("What is your blood pressure reading today?"), STT mic button for BP/weight input
- **Chat:** TTS reads AI responses aloud, STT mic button for message input
- Triggered by `AUDIO_FIRST` communication preference or manual toggle button
- Language-aware: uses `es-ES` or `en-US` based on user's `preferredLanguage`

```javascript
// TTS example
const utterance = new SpeechSynthesisUtterance("Your blood pressure reading is 142 over 88");
utterance.lang = 'en-US'; // or 'es-ES'
window.speechSynthesis.speak(utterance);

// STT example
const recognition = new webkitSpeechRecognition();
recognition.lang = 'en-US';
recognition.onresult = (event) => {
  const transcript = event.results[0][0].transcript;
  // Parse BP values from transcript
};
recognition.start();
```

---

## Verification Checklist

- [ ] Run `npx prisma db seed` — confirm data appears in provider dashboard
- [ ] Provider dashboard → patients list → click patient → see alerts
- [ ] Scheduled calls page → see upcoming calls as cards
- [ ] Toggle audio on check-in → hear questions read aloud, use mic for input
- [ ] Toggle language to ES → see Spanish labels on check-in and dashboard
- [ ] Deploy to Railway/Vercel → confirm end-to-end flow works
- [ ] Provider dashboard shows interaction counts (not just patient count)
