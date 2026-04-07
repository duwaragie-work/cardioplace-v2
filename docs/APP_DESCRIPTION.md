# Healplace Cardio — App Description Document

> Product description for the Elevance Health Foundation Patient Safety Prize submission.
> Last updated: April 3, 2026 | Status: Feature-complete, demo-ready

---

## What Is Healplace Cardio?

Healplace Cardio is a cardiovascular patient monitoring platform that keeps patients and their care teams connected between clinic visits. It combines daily blood pressure check-ins, medication tracking, and an AI-powered health assistant to catch dangerous trends early — before they become emergencies.

**Tagline:** *Your Heart Health, Monitored Between Every Visit*

---

## Why Cardio? Why Now?

Cardiovascular disease is the leading cause of death in the United States. But most of the damage happens silently — between doctor visits. A patient might have dangerously high blood pressure for weeks without knowing, because they only see a provider once every few months.

The communities hit hardest are the ones with the fewest resources. In Washington DC's Wards 7 and 8, residents face some of the highest rates of hypertension, heart failure, and stroke in the country. Many are uninsured or on Medicaid. Many work long hours — as healthcare workers, caregivers, or essential workers — and can't easily get to a clinic. Many speak languages other than English at home. And many struggle with health literacy — not because they lack intelligence, but because the healthcare system wasn't designed to communicate with them.

Healplace Cardio was built to change that.

---

## Who It's For

### Patients
- People managing hypertension (high blood pressure), heart failure, or post-cardiac-event recovery
- Family members helping loved ones manage their health
- Healthcare workers (nurses, aides) who themselves face high rates of obesity and hypertension
- People in underserved communities who need monitoring between sparse clinic visits

### Care Teams
- Physicians, nurses, and care coordinators at partner hospitals
- Clinical partners: Cedar Hill Regional Medical Center, BridgePoint Hospital (Harborside), AmeriHealth (managed Medicaid)

---

## What It Does

### 1. Daily Blood Pressure Check-Ins
Patients can log their vitals in three ways — whichever feels most natural:
- **The check-in form** — a simple 5-step mobile-friendly flow
- **Text chat** — tell the AI assistant "My blood pressure is 140 over 90" and it walks you through a full check-in conversationally, confirming each value before saving
- **Voice chat** — speak your readings out loud and the AI records them hands-free

All three methods capture the same clinical data. The system tracks:
- **Systolic and diastolic blood pressure**
- **Weight changes**
- **Whether medication was taken**
- **Symptoms** — chest pain, headache, shortness of breath, dizziness, blurred vision, fatigue, nausea, swelling, palpitations

Tips guide patients through proper measurement technique: *"Sit quietly for 5 minutes before measuring"*, *"Rest your arm on a flat surface at heart level."*

### 2. Smart Baseline & Trend Detection
The platform computes a **7-day rolling baseline** of each patient's blood pressure. Once established (after 3+ readings on different days), it continuously compares new readings against that personal baseline — not just generic medical thresholds.

This means the system catches **your** dangerous trend, not just a textbook number. A patient whose normal is 120/80 getting a reading of 155/95 is flagged — even though 155/95 might not trigger a generic alarm.

### 3. Two-Level Escalation System
When readings are consistently elevated (3+ consecutive days of deviation), the system determines the clinical severity:

- **Level 1 — Care Team Alert (24-hour response):** Elevated readings with medication non-adherence. The patient gets a gentle reminder. The care team gets a detailed update.
- **Level 2 — Urgent Clinical Review (Immediate):** Elevated readings *despite* taking medication, with symptoms present. This means something is clinically wrong — not just a missed pill. The care team is notified immediately for intervention.

The system is smart about what it escalates. It considers medication compliance rates, symptom presence, and trend duration — not just a single high reading.

### 4. AI Health Assistant
An AI-powered conversational assistant that:
- **Records check-ins through text or voice conversation** — patients can type or speak their blood pressure and the AI walks them through a full check-in, confirming every value before saving
- **Explains blood pressure numbers** in simple, clear language
- **Answers questions** about heart health, medications, and symptoms
- **Reinforces healthy habits** — medication adherence, lifestyle behaviors, understanding what their numbers mean
- **Detects emergencies** — if a patient reports crushing chest pain, sudden numbness, or inability to breathe *right now*, the AI immediately directs them to call 911

The AI never diagnoses. It never prescribes. It educates, encourages, and connects.

### 5. Provider Dashboard
Care teams get a real-time view of their patient panel:
- **Alert queue** with severity levels and BP trend charts
- **Patient roster** filterable by risk tier (Standard, Elevated, High)
- **Interaction tracking** — check-ins, chat messages, voice engagements
- **Scheduled call management** — follow-up calls with date, time, type, and notes
- **BP trend charts** showing 7-day and 90-day patterns
- **One-click drill-down** into any patient's readings, alerts, escalations, and communication history

### 6. Notifications & Care Coordination
The platform generates context-aware notifications for both patients and care teams:
- **Patient notifications:** Gentle reminders, check-in encouragements, escalation explanations
- **Care team notifications:** Alert summaries, trend reports, medication adherence flags
- **Scheduled calls:** Providers can schedule follow-up phone or video calls directly from the alert queue

---

## What Makes It Different

### Audio-First Mode: Silent Literacy by Design

This is not an accessibility afterthought. This is a core design principle.

**The problem:** Millions of Americans have low health literacy. They can't read a medication label, interpret a blood pressure reading, or understand written discharge instructions. But they'll never tell you that. Health literacy barriers are *silent* — patients nod, say they understand, and go home confused. Studies show that low health literacy is directly linked to worse cardiovascular outcomes, more ER visits, and higher mortality.

**Our approach:** Healplace Cardio doesn't ask patients to identify themselves as low-literacy. Instead, the platform offers two communication modes from the very first interaction:

- **Text First** — Traditional typed interaction with the AI assistant
- **Audio First** — Full voice-based interaction where patients *speak* their check-ins and *listen* to the AI's responses

When a patient selects **Audio First** during onboarding (or when silent indicators suggest it), the entire experience shifts:
- Check-ins happen through **voice conversation**, not forms
- The AI speaks responses aloud instead of displaying text
- Instructions are verbal and reinforced through repetition
- The interface centers around a **voice orb** — a simple, non-intimidating visual that shows when the AI is listening, thinking, or speaking

**Why this matters:** A patient who can't read "Take your Lisinopril 10mg once daily with food" *can* understand when the AI says it out loud. A patient who freezes at a 5-step form *can* tell the AI "My blood pressure was 140 over 90 this morning." The clinical data captured is identical. The patient experience is radically different.

**Silent detection:** The system doesn't require patients to self-identify. Communication preferences are set during onboarding as a simple choice — not a literacy test. The provider dashboard shows each patient's communication preference so care teams can adapt their outreach accordingly.

This is what we mean by **silent literacy coverage** — meeting patients where they are, without making them disclose what they can't do.

### Multilingual From Day One

Healthcare doesn't happen in one language. Healplace Cardio supports **five languages** from the start:
- English
- Spanish
- Amharic
- French
- German

The AI assistant detects language automatically. If a patient starts typing or speaking in Spanish, the AI switches to Spanish immediately and stays there — no settings menu required, no awkward language selection popup. The entire interface adapts.

For communities like DC's Ward 7 and 8 — where significant populations speak Spanish, Amharic, and French — this isn't a feature. It's a requirement.

### Designed for the People Who Need It Most

Every design decision in Healplace Cardio was made with underserved communities in mind:

- **Mobile-first design** — because most patients in our target communities access the internet through their phones, not computers
- **Simple, warm language** — written at an 8th-grade reading level, non-alarmist, encouraging
- **Voice-first option** — for patients who struggle with text-based interfaces
- **No complex setup required** — onboarding is 3 optional fields. Patients can skip everything and start their first check-in in under a minute
- **Gentle nudges, not guilt** — "Missing evening doses is common. Try linking it to a daily routine — like dinner or brushing your teeth."
- **Family involvement** — the platform acknowledges that family members often help manage medications and health decisions
- **Healthcare worker awareness** — nurses and aides in our partner hospitals face their own hypertension challenges. The platform serves them too

---

## The Technology

### How It Works (Simply)
1. Patient logs in (email + one-time code, no password to remember)
2. Completes a brief optional onboarding (name, date of birth, communication preference)
3. Logs daily blood pressure through the check-in form, text chat, or voice conversation with the AI assistant
4. The system computes their personal baseline and watches for dangerous trends
5. If trends are detected, the system escalates to the care team at the appropriate clinical level
6. The care team reviews alerts on their dashboard and schedules follow-up calls
7. The cycle continues — daily monitoring, early detection, timely intervention

### Under the Hood
- **Backend:** NestJS + Prisma + PostgreSQL — handles check-in processing, baseline computation, deviation detection, escalation logic, and AI integration
- **Frontend:** Next.js + Tailwind CSS — mobile-responsive, animated, accessible
- **Voice:** Real-time audio processing via WebSocket — 16kHz capture, streaming transcription, AI response playback
- **AI:** Mistral-powered conversational assistant with full patient context injection — the AI knows your name, your baseline, your medication history, and your recent readings
- **Event Pipeline:** ENTRY_CREATED → BASELINE_COMPUTED → DEVIATION_DETECTED → ESCALATION_CREATED — every check-in triggers a cascade of clinical logic
- **RPM-Ready:** Designed to align with new Medicare Remote Patient Monitoring billing codes (2-15 interactions/month)

---

## The Mission

Healplace Cardio exists because the gap between doctor visits is where patients are most vulnerable — and most alone. A 15-minute appointment every 3 months cannot manage a condition that changes every day.

We believe that:
- **Every patient deserves daily monitoring**, not just the ones who can afford concierge care
- **Language should never be a barrier** to understanding your own health
- **Literacy should never be a barrier** to getting the care you need
- **Technology should meet people where they are** — on their phones, in their language, in their preferred mode of communication
- **Care teams need better tools** to manage patients between visits — not more paperwork, but smarter alerts and real context

Built for the Elevance Health Foundation Patient Safety Prize. Designed for the communities that need it most. Ready to scale.

---

## Key Numbers (Demo Data)

- **8 demo patients** with 90 days of realistic cardiovascular data each
- **~1,200+ monthly interactions** across check-ins, chat messages, and voice engagements
- **3 risk tiers:** Standard, Elevated, High
- **2 escalation levels:** L1 (24-hour care team alert), L2 (immediate clinical review)
- **5 languages** supported from day one
- **9 tracked symptoms** per check-in
- **7-day rolling baseline** personalized to each patient
- **~$15/month** target operational cost per patient

---

## Partner Organizations

- **Cedar Hill Regional Medical Center** — Inpatient + outpatient cardiology
- **BridgePoint Hospital (Harborside)** — Long-term acute care
- **AmeriHealth** — Managed Medicaid payer
- **DCHA (DC Hospital Association)** — Lead organization

---

*Healplace Cardio — Because your heart doesn't stop between appointments.*
