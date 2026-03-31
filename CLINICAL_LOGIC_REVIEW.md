# Healplace Cardio — Clinical Logic Review

**For:** Dr. Manisha (CEO) — Clinical review & feedback
**Date:** March 27, 2026
**Status:** Prototype implementation — all thresholds configurable

---

## 1. Patient Check-In (Daily Journal Entry)

Each day, a patient submits a check-in with:

| Field | Range | Required? |
|-------|-------|-----------|
| Systolic BP | 60–250 mmHg | Optional |
| Diastolic BP | 40–150 mmHg | Optional |
| Weight | 20–300 kg | Optional |
| Medication Taken | Yes / No | Optional |
| Missed Doses | 0–10 | Optional |
| Symptoms | Free-text list (e.g. "chest pain", "headache") | Optional |
| Teach-Back Answer | Patient's answer to an education question | Optional |
| Source | Manual entry or HealthKit sync | Default: manual |

> **Question for Manisha:** Should any of these be required? For example, should we enforce BP entry every check-in?

---

## 2. Baseline Calculation (Per Patient, Rolling)

### How it works
- We use a **7-day rolling window** of the patient's own data
- A baseline requires a **minimum of 3 BP entries** within that 7-day window
- Baseline is recalculated every time a new entry is added

### Formula
```
Baseline Systolic  = Average of all systolicBP values in the last 7 days
Baseline Diastolic = Average of all diastolicBP values in the last 7 days
Baseline Weight    = Average of all weight values in the last 7 days (if available)
```

### Example
| Day | Systolic | Diastolic |
|-----|----------|-----------|
| Mon | 132 | 85 |
| Wed | 128 | 82 |
| Fri | 136 | 88 |

**Baseline** = Systolic: (132+128+136)/3 = **132 mmHg** | Diastolic: (85+82+88)/3 = **85 mmHg**

### What happens with fewer than 3 entries?
- No personal baseline is established
- The system falls back to **absolute thresholds only** (see Section 3)
- This is common for new patients in their first week

> **Question for Manisha:**
> - Is a simple average appropriate, or should we weight more recent readings higher?
> - Should the minimum be 3 entries, or more (e.g. 5) for clinical confidence?
> - Should the window be 7 days, or longer (e.g. 14 days)?

---

## 3. Deviation Detection (Flagging Abnormal Readings)

A deviation is detected when a patient's reading exceeds either an **absolute threshold** (fixed number) or a **relative threshold** (compared to their personal baseline).

### Current Thresholds

#### Systolic BP
| Condition | Trigger | Severity |
|-----------|---------|----------|
| Systolic > **180 mmHg** | Absolute | **HIGH** (critical) |
| Systolic > **160 mmHg** | Absolute | MEDIUM |
| Systolic > **baseline + 20 mmHg** | Relative to personal baseline | MEDIUM |

#### Diastolic BP
| Condition | Trigger | Severity |
|-----------|---------|----------|
| Diastolic > **110 mmHg** | Absolute | **HIGH** (critical) |
| Diastolic > **100 mmHg** | Absolute | MEDIUM |
| Diastolic > **baseline + 15 mmHg** | Relative to personal baseline | MEDIUM |

#### Medication Adherence
| Condition | Severity |
|-----------|----------|
| Patient reports medication **not taken** | MEDIUM |

### How both triggers work together
When a patient has an established baseline (3+ entries), we check **both**:
1. Is the reading above the absolute threshold? (e.g. systolic > 160)
2. Is the reading significantly above their personal baseline? (e.g. baseline is 125, reading is 148 → +23, exceeds the +20 relative threshold)

**Either trigger is enough** to create a deviation alert.

### Auto-Resolution
When a patient's next reading comes back within normal range, any open deviation alerts are **automatically resolved**.

> **Questions for Manisha:**
> - Are these absolute thresholds clinically appropriate? (180/110 for HIGH, 160/100 for MEDIUM)
> - Should the relative thresholds (+20 systolic, +15 diastolic) be different?
> - **Personalised thresholds:** You mentioned different patients should have different escalation points. For example, a patient with a baseline of 150 might need different thresholds than someone with a baseline of 120. How should we handle this?
>   - Option A: Configurable per-patient thresholds set by the care team
>   - Option B: Percentage-based relative thresholds instead of fixed +20/+15
>   - Option C: Risk-tier groupings (e.g. "high-risk" patients get tighter thresholds)
> - **Medication-specific thresholds:** Currently we treat all patients the same regardless of their medication. But a patient on beta-blockers may have different "normal" BP ranges than a patient on ACE inhibitors, calcium channel blockers, or no medication at all. Should we:
>   - Adjust deviation thresholds based on which medication the patient is taking?
>   - Track medication type (not just taken/missed) so the system knows what "normal" looks like for that drug?
>   - Flag different urgency levels depending on the medication? (e.g. a spike while on medication may be more concerning than the same reading from an unmedicated patient)
> - Should we also detect **low** BP? (e.g. systolic < 90 mmHg — hypotension risk, especially relevant for patients on antihypertensives)
> - Should weight deviations trigger alerts? (e.g. sudden weight gain could indicate fluid retention)

---

## 4. Escalation Rules (When to Alert the Care Team)

### Trigger Condition
An escalation is created when the **same type of deviation occurs on 3 out of the last 3 days**.

Example: If a patient has elevated systolic BP on Monday, Tuesday, and Wednesday → escalation triggers on Wednesday.

### Escalation Levels

| Level | When | Action |
|-------|------|--------|
| **LEVEL 2 — Critical** | Severity is HIGH **OR** emergency symptoms detected | Immediate alert |
| **LEVEL 1 — Standard** | Severity is MEDIUM, no emergency symptoms | 24-hour follow-up |

### Emergency Symptoms (Trigger Immediate LEVEL 2)
If any of these symptoms are reported in a check-in, escalation goes straight to LEVEL 2 regardless of BP readings:
- Chest pain
- Severe headache
- Sudden numbness
- Vision changes
- Shortness of breath
- Syncope / Fainting

### Messages Sent

**To Patient (LEVEL 2 — Critical):**
> "URGENT: Your blood pressure reading indicates a medical emergency. Call 911 immediately or go to your nearest emergency room."

**To Patient (LEVEL 1 — Standard):**
> "Your recent blood pressure reading has been flagged. Your care team has been notified and will follow up with you within 24 hours."

**To Care Team (LEVEL 2):**
> "IMMEDIATE ACTION REQUIRED: Patient [name] has critical BP readings ([systolic]/[diastolic] mmHg). Emergency escalation triggered."

**To Care Team (LEVEL 1):**
> "FOLLOW-UP WITHIN 24H: Patient [name] has elevated BP readings ([systolic]/[diastolic] mmHg). Review recommended."

> **Questions for Manisha:**
> - Is 3 consecutive days the right trigger? Should it be 2 days for HIGH severity?
> - Should a single HIGH reading (e.g. systolic > 180) trigger an immediate escalation without waiting for 3 days?
> - Are the emergency symptoms complete? Should we add others? (e.g. leg swelling, confusion, irregular heartbeat)
> - Should LEVEL 2 automatically connect to a nurse line instead of just messaging?
> - **Personalised escalation:** Should the 3-day rule be configurable per patient? For higher-risk patients, maybe escalate after just 1 abnormal reading?

---

## 5. Notification Channels

When an escalation fires, notifications are sent through:

| Channel | Status | Details |
|---------|--------|---------|
| In-App Push | **Working** | Immediate notification in the app |
| Email | **Working** | Sent if patient has email on file |
| SMS | **Planned** | Not yet integrated |

Each notification includes **personalised health tips** based on the deviation type:

- **High Systolic BP tips:** Reduce sodium to <1,500mg/day, deep breathing 10 min daily, consistent BP measurement timing, avoid caffeine and alcohol
- **High Diastolic BP tips:** 30+ minutes moderate exercise, maintain healthy weight, limit processed foods/increase potassium, stress management
- **Medication Missed tips:** Set daily alarms/pill organizer, keep medication visible, talk to care team about side effects, refill before running out

LEVEL 2 escalations include 4 tips; LEVEL 1 include 2 tips.

---

## 6. AI Chatbot Clinical Context

The AI chatbot receives the patient's clinical data to personalise conversations:

### What the AI knows about each patient
- Last 7 days of BP readings with medication status
- Current baseline values (if established)
- Any active deviation alerts
- Communication preference and preferred language

### AI Behavior Rules
- Acts as a cardiovascular health assistant for hypertension patients
- Reviews recent BP readings and medication adherence
- Provides evidence-based cardiovascular education
- Asks one **teach-back question** per session (to verify patient understanding)
- Flags concerns but **never diagnoses**
- Communicates at an **8th grade reading level**
- Uses warm, non-alarmist tone

### Emergency Detection in Chat
If a patient mentions any of these in conversation, the AI immediately instructs them to **call 911**:
- Chest pain
- Severe headache
- Sudden numbness
- Vision changes
- Shortness of breath

---

## 7. Full Event Pipeline (How It All Connects)

```
Patient submits daily check-in
        │
        ▼
  ┌─────────────────┐
  │  ENTRY CREATED   │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────────────────┐
  │  BASELINE RECALCULATED       │
  │  (7-day rolling average)     │
  │  Need ≥3 entries in window   │
  └────────┬────────────────────┘
           │
           ▼
  ┌─────────────────────────────┐
  │  DEVIATION CHECK             │
  │  Compare reading against:    │
  │  • Absolute thresholds       │
  │  • Personal baseline         │
  └────────┬────────────────────┘
           │
     Deviation found?
     ┌─────┴─────┐
     No          Yes
     │            │
     ▼            ▼
   (done)   ┌─────────────────────┐
            │  3+ days in a row?   │
            └───┬─────────────────┘
                │
          ┌─────┴─────┐
          No          Yes
          │            │
          ▼            ▼
        (wait)   ┌──────────────────┐
                 │  ESCALATION       │
                 │  Level 1 or 2     │
                 └────────┬─────────┘
                          │
                          ▼
                 ┌──────────────────┐
                 │  NOTIFICATIONS    │
                 │  Patient + Care   │
                 │  Team alerted     │
                 └──────────────────┘
```

---

## 8. Summary of Key Decisions Needing Clinical Input

| # | Question | Current Default | Options |
|---|----------|----------------|---------|
| 1 | Baseline window | 7 days, 3 entries min | Could be longer window or more entries |
| 2 | Baseline formula | Simple average | Could weight recent readings higher |
| 3 | Systolic HIGH threshold | >180 mmHg | Configurable |
| 4 | Systolic MEDIUM threshold | >160 mmHg (absolute) or >baseline+20 (relative) | Configurable |
| 5 | Diastolic HIGH threshold | >110 mmHg | Configurable |
| 6 | Diastolic MEDIUM threshold | >100 mmHg (absolute) or >baseline+15 (relative) | Configurable |
| 7 | Escalation trigger | 3 same-type deviations in 3 consecutive days | Could be fewer for high-risk patients |
| 8 | Single critical reading | Requires 3-day pattern for escalation | Should 1 reading >180 escalate immediately? |
| 9 | Per-patient thresholds | Same thresholds for all patients | Could be configurable per patient by care team |
| 10 | Hypotension detection | Not implemented | Should we flag systolic <90? |
| 11 | Weight-based alerts | Not implemented | Sudden weight gain = fluid retention risk |
| 12 | Emergency symptoms list | 7 symptoms | May need more (leg swelling, confusion, etc.) |
| 13 | Medication-aware thresholds | Not implemented | Should thresholds differ based on what medication the patient is on? (e.g. a patient on beta-blockers vs ACE inhibitors vs no medication may have different "normal" ranges and different escalation points) |

---

*This document reflects what is currently implemented in code. All thresholds and rules are configurable — we just need clinical guidance on the right values.*
