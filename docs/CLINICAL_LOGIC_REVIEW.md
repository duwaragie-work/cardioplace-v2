# Healplace Cardio — Clinical Logic Implementation

**Date:** April 3, 2026
**Status:** Fully implemented — all thresholds configurable

---

## 1. Patient Check-In (Daily Journal Entry)

Each day, a patient submits a check-in capturing:

| Field | Range | Notes |
|-------|-------|-------|
| Systolic BP | 60-250 mmHg | Primary vital |
| Diastolic BP | 40-150 mmHg | Primary vital |
| Weight | 20-300 kg | Tracks fluid retention |
| Medication Taken | Yes / No | Adherence tracking |
| Missed Doses | 0-10 | Compliance detail |
| Symptoms | Multi-select (9 options) | Chest pain, headache, SOB, dizziness, blurred vision, fatigue, nausea, swelling, palpitations |
| Teach-Back Answer | Free text | Health literacy verification |
| Source | Manual / HealthKit | Entry origin tracking |

All fields are optional to reduce friction. The 5-step progressive form guides patients through: Date > BP > Weight > Medication > Symptoms.

---

## 2. Baseline Calculation (Per Patient, Rolling)

### Algorithm
- **Window:** 7-day rolling period
- **Minimum:** 3 BP entries within the window
- **Recalculation:** Every new entry triggers a fresh baseline computation
- **Formula:** Simple arithmetic mean of all readings in the window

```
Baseline Systolic  = Mean(systolicBP values, last 7 days)
Baseline Diastolic = Mean(diastolicBP values, last 7 days)
Baseline Weight    = Mean(weight values, last 7 days)
```

### Example
| Day | Systolic | Diastolic |
|-----|----------|-----------|
| Mon | 132 | 85 |
| Wed | 128 | 82 |
| Fri | 136 | 88 |

**Baseline:** Systolic = 132 mmHg | Diastolic = 85 mmHg

### New Patient Handling
Patients with fewer than 3 entries have no personal baseline. The system uses **absolute thresholds only** until enough data accumulates (typically 3-5 days).

---

## 3. Deviation Detection

A deviation alert is created when a reading exceeds either an **absolute threshold** (fixed clinical value) or a **relative threshold** (compared to the patient's personal baseline). Either trigger alone is sufficient.

### Systolic BP Thresholds
| Condition | Trigger Type | Severity |
|-----------|-------------|----------|
| Systolic > **180 mmHg** | Absolute | **HIGH** |
| Systolic > **160 mmHg** | Absolute | MEDIUM |
| Systolic > **baseline + 20 mmHg** | Relative | MEDIUM |

### Diastolic BP Thresholds
| Condition | Trigger Type | Severity |
|-----------|-------------|----------|
| Diastolic > **110 mmHg** | Absolute | **HIGH** |
| Diastolic > **100 mmHg** | Absolute | MEDIUM |
| Diastolic > **baseline + 15 mmHg** | Relative | MEDIUM |

### Medication Adherence
| Condition | Severity |
|-----------|----------|
| Medication **not taken** | MEDIUM |

### Dual-Trigger System
When a baseline exists, the system checks **both** absolute and relative thresholds simultaneously. A patient with a normal baseline of 125 mmHg who reads 148 mmHg (+23, exceeding the +20 relative threshold) gets flagged — even though 148 is below the 160 absolute threshold. This catches **personal** dangerous trends, not just textbook numbers.

### Auto-Resolution
When a patient's next reading falls within normal range, open deviation alerts are **automatically resolved**, keeping the alert queue clean for providers.

---

## 4. Escalation Rules

### Trigger
An escalation fires when the **same deviation type occurs on 3 consecutive days**.

Example: Elevated systolic on Monday, Tuesday, Wednesday → escalation triggers Wednesday.

### Escalation Levels

| Level | Trigger | Response |
|-------|---------|----------|
| **LEVEL 2 — Critical** | HIGH severity **OR** emergency symptoms | Immediate alert to care team |
| **LEVEL 1 — Standard** | MEDIUM severity, no emergency symptoms | 24-hour follow-up window |

### Emergency Symptoms (Immediate LEVEL 2)
These symptoms trigger LEVEL 2 escalation **regardless of BP readings**:
- Chest pain
- Severe headache
- Sudden numbness
- Vision changes
- Shortness of breath
- Syncope / Fainting

### Notification Messages

**Patient — LEVEL 2 (Critical):**
> "URGENT: Your blood pressure reading indicates a medical emergency. Call 911 immediately or go to your nearest emergency room."

**Patient — LEVEL 1 (Standard):**
> "Your recent blood pressure reading has been flagged. Your care team has been notified and will follow up with you within 24 hours."

**Care Team — LEVEL 2:**
> "IMMEDIATE ACTION REQUIRED: Patient [name] has critical BP readings ([systolic]/[diastolic] mmHg). Emergency escalation triggered."

**Care Team — LEVEL 1:**
> "FOLLOW-UP WITHIN 24H: Patient [name] has elevated BP readings ([systolic]/[diastolic] mmHg). Review recommended."

---

## 5. Notification Channels

| Channel | Status |
|---------|--------|
| In-App | **Active** — Immediate push within the app |
| Email | **Active** — Via Resend (OTP, alerts, call scheduling) |
| SMS | Scaffolded — Channel defined, integration ready |

### Personalized Health Tips
Each notification includes context-specific tips based on the deviation type:

- **High Systolic:** Reduce sodium to <1,500mg/day, deep breathing 10 min daily, consistent BP measurement timing, avoid caffeine and alcohol
- **High Diastolic:** 30+ minutes moderate exercise, maintain healthy weight, limit processed foods/increase potassium, stress management
- **Medication Missed:** Set daily alarms/pill organizer, keep medication visible, talk to care team about side effects, refill before running out

LEVEL 2 escalations include 4 tips; LEVEL 1 includes 2 tips.

---

## 6. AI Chatbot Clinical Integration

### Patient Context Injected into Every Conversation
- Patient name, age, risk tier, communication preference
- Last 7 days of BP readings with medication status
- Current baseline values (systolic, diastolic, weight)
- Active deviation alerts and escalation history
- Preferred language (EN/ES/AM/FR/DE)

### AI Behavior Rules
- Acts as a cardiovascular health assistant for hypertension patients
- Reviews recent BP readings and medication adherence
- Provides evidence-based cardiovascular education
- Asks teach-back questions to verify patient understanding
- Communicates at an **8th grade reading level** with warm, non-alarmist tone
- **Never diagnoses or prescribes** — educates, encourages, and connects
- Can create/update journal entries directly from conversation (tool integration)

### Emergency Detection in Chat
If a patient mentions chest pain, severe headache, sudden numbness, vision changes, or shortness of breath, the AI immediately instructs them to **call 911** and logs an emergency event.

---

## 7. Event Pipeline

```
Patient submits daily check-in
        |
        v
  ENTRY_CREATED
        |
        v
  BASELINE_COMPUTED
  (7-day rolling average, min 3 entries)
        |
        v
  DEVIATION_CHECK
  (absolute thresholds + personal baseline)
        |
   Deviation found?
   +------+------+
   No            Yes
   |              |
   v              v
 (done)    3+ consecutive days?
           +------+------+
           No            Yes
           |              |
           v              v
         (wait)    ESCALATION_CREATED
                   (Level 1 or 2)
                          |
                          v
                   NOTIFICATIONS
                   (Patient + Care Team)
```

---

## 8. Configurable Parameters

All clinical thresholds are configurable for future per-patient customization:

| Parameter | Current Value | Configurable |
|-----------|--------------|-------------|
| Baseline window | 7 days | Yes |
| Minimum entries for baseline | 3 | Yes |
| Systolic HIGH threshold | >180 mmHg | Yes |
| Systolic MEDIUM threshold | >160 mmHg absolute, >baseline+20 relative | Yes |
| Diastolic HIGH threshold | >110 mmHg | Yes |
| Diastolic MEDIUM threshold | >100 mmHg absolute, >baseline+15 relative | Yes |
| Escalation trigger | 3 same-type deviations in 3 consecutive days | Yes |
| Emergency symptoms | 6 symptoms (chest pain, headache, numbness, vision, SOB, syncope) | Yes |

---

*All clinical logic is implemented, tested with 90 days of seed data across 8 patients, and ready for clinical review and tuning.*
