# Reporting Features — Build Documentation

This document describes the **time-based reports and quality-metric features**
being added on top of the existing Monthly Practice Report. There are four
reports in this group; each gets its own section below as it is built.

| # | Report | Status |
|---|---|---|
| 1 | 90-day medication adherence | ✅ Built (provisional) |
| 2 | Quarterly outcomes (BP control + alert-volume trend) | ✅ Built (provisional) |
| 3 | Alert-resolution-time SLAs | ✅ Built (provisional) |
| 4 | Per-condition cohort reports | ✅ Built (provisional) |

Each section follows the same layout so the document stays consistent:
**What it had to do → What was built → Blockers → Decisions taken → How the
logic works.**

---

## Task 1 — 90-Day Medication Adherence Report

### 1. What it had to do
Produce a report that answers one question:

> **"Over the last 90 days, are patients actually taking their blood-pressure
> medication?"**

The information needed already exists — every time a patient logs a check-in,
they record whether they took their medication. Nothing was adding that up.
This report adds it up and presents it per patient and per practice, viewable
on screen and downloadable as a spreadsheet (CSV) or printable PDF.

### 2. What was built

**Backend (the calculation + downloads)**
- A new service that scans 90 days of check-ins and computes adherence.
- Three endpoints: view the report (JSON), download CSV, download PDF.
- Reuses the existing report permissions — only oversight roles can read it,
  and each read is recorded in the audit log (same as the Monthly report).
- Unit tests covering the calculation.

**Frontend (the screen)**
- The adherence report appears as a second tab on the existing **Reports**
  page (alongside the Monthly report — no separate menu item).
- Shows a summary (four headline numbers), a per-patient table with a
  plain-language legend, a window selector (30 / 60 / 90 / 180 days), and
  CSV / PDF download buttons.
- The printable PDF carries a short "provisional" note (see Blockers). The
  on-screen banner was removed to keep the screen clean.

**Important:** no database change was required. Everything is calculated live
from existing data, so there was no migration and no risk to existing tables.

### 3. Blockers

There was **no agreed definition of "taking medication properly."** Real-life
check-ins are messy, and several judgment calls are not technical decisions —
they are clinical ones that require sign-off before the numbers are treated as
official:

- A patient takes 3 of 4 pills — is that good or bad?
- A patient says "not due yet, I'll take it tonight" — should that count
  against them?
- What percentage is the line between "doing fine" and "needs follow-up"?

Because of this, the report is shipped as **provisional**: the calculation runs
and the screen works today, but it is clearly labelled as pending clinical
sign-off. When the definitions are confirmed, only a small configuration value
changes — no rebuild.

### 4. Decisions taken (sensible defaults, pending sign-off)

To keep the work moving while the definitions are confirmed, the following
defaults were chosen. They are based on the standard pharmacy-industry
adherence measure (PDC — Proportion of Days Covered):

| Decision | Choice made | Reasoning |
|---|---|---|
| What counts as "due" | A check-in where the patient was asked about meds **and answered** | Only real opportunities to take medication count |
| "Not due yet" check-ins | **Excluded** (neutral — neither helps nor hurts) | The patient correctly reported it wasn't time yet; not a miss |
| Unanswered check-ins | **Excluded** | Can't score what wasn't answered |
| Patients with no medications | **Not included** in the report | Adherence doesn't apply to them |
| "Below target" line | **Below 80%** | 80% is the widely used industry adherence cut-off |
| Window length | **90 days** by default (30 / 60 / 180 selectable) | Matches the "quarter" intent of the report |

All of these live in **one configuration block** so any of them can be changed
in a single place once confirmed.

### 5. What the patient enters (the raw input)

Every check-in asks the patient whether they took their medication. They pick
one of three answers:

- ✅ **Yes** — took it
- ❌ **No** — didn't take it (this also reveals a small **+ / − counter** so
  the patient can say *how many doses* they missed: 1, 2, 3 …)
- ⏳ **Not due yet** — it isn't time for this dose

That's the entire raw input. The report is simply a tally of these answers
over the chosen window.

### 6. How the logic works

**Step 1 — Find the patients.**
Take every patient assigned to the practice who has **at least one active
medication**. These are the only patients adherence applies to.

**Step 2 — Pull their check-ins** from the chosen window (default 90 days).

**Step 3 — For each check-in, decide if a dose was "due."**

> **"Due" = the patient was supposed to take a dose** — i.e. they answered
> **Yes** or **No**. So **Due = Yes + No**.

- **Yes** → counts as **due + taken**
- **No** → counts as **due, not taken**
- **Not due yet** (or no answer) → **skipped**, not counted either way

**Step 4 — Score each patient.**

```
Adherence % = (times taken) ÷ (times due) × 100
```

- 80% or above → **On track**
- Below 80% → **Below target**
- No due check-ins at all → **No data**

**Step 5 — Score the whole practice.**
The practice figure is **pooled**, not an average of the per-patient
percentages:

```
Practice adherence % = (all times taken) ÷ (all times due) × 100
```

This prevents a single patient with very few check-ins from distorting the
practice number.

**Step 6 — Present it.**
The summary tiles show: practice adherence, how many patients are below target,
how many are reporting vs. have no data, and total reported missed doses. The
table lists each patient worst-first (Below target at the top), so the patients
who need follow-up are immediately visible.

### 7. What each column means

| Column | Means | Counts |
|---|---|---|
| **Status** | On track / Below target / No data | — |
| **Adherence** | times taken ÷ times due | a percentage |
| **Times due** | check-ins where a dose was due (Yes + No) | check-ins |
| **Times taken** | of those, how many were taken (Yes) | check-ins |
| **Doses missed** | total doses the patient reported missing | doses (pills) |

Note the units differ on purpose: *Times due / Times taken* count **check-ins**,
while *Doses missed* counts **individual doses**. A short legend under the table
spells this out on screen.

### 8. How "Doses missed" is counted

When a patient answers **No**, the form records how many doses they missed for
**each medication** (the + / − counter). A patient on several medications can
therefore report several missed doses on a single check-in.

The report **adds up those per-medication counts**. (An earlier version read a
single legacy field that always held "1" and so undercounted — this was
corrected so the real per-medication totals are summed.)

Example: on one check-in a patient marks two medications as missed, one with a
count of 10 and one with a count of 3 → **Doses missed = 13** for that check-in.

### 9. Worked examples

**One patient** with 7 times due, 5 taken:

```
5 ÷ 7 = 0.7143 = 71.43%  →  below 80%  →  "Below target"
```

**Another patient** — 35 times due, 29 taken:

```
times due 35 = 29 Yes + 6 No
29 ÷ 35 = 0.8286 = 82.86%  →  "On track"
(plus, say, 1 separately reported missed dose)
```

Note "Doses missed" is a **separate** counter — it is not the same as the 6
"No" answers above.

**Whole practice** — 146 taken out of 154 due across all patients:

```
146 ÷ 154 = 0.9481 = 94.81%  →  practice adherence
```

### 10. Known limitations (important to understand)

- **Counts per check-in, not per pill (for due/taken).** If a patient is on 5
  medications, one check-in is a single Yes/No for "your medication" — it counts
  as **1 times-due**, not 5. (Per-pill scoring is a possible future refinement.)
  *Doses missed* is the exception — it already uses the per-medication counts.
- **Counts every check-in, not once per day.** If a patient logs 10 check-ins in
  one day, all 10 are tallied, so a heavy logger carries more weight than a
  once-a-day logger. Switching to once-per-day is an easy future change if wanted.

### 11. What's left for this report
Only the **definitions** in section 4 need confirmation. The build itself is
complete and working. Once the definitions are signed off, the single
configuration block is updated.

---

## Task 2 — Quarterly Outcomes Report

### 1. What it had to do
Produce a report covering **one calendar quarter (3 months)** that answers two
"are patients doing better" questions — a different angle from the Monthly
report (which is about how fast the team responds to alerts). The two questions:

1. **Alert-volume trend** — is the number of alerts going up or down across the
   three months of the quarter?
2. **BP-control rate** — what percentage of patients have their blood pressure
   under control?

### 2. What was built

**Backend (the calculation + downloads)**
- A new service that builds both views for a chosen quarter and practice.
- Three endpoints: view (JSON), download CSV, download PDF.
- Reuses the existing report permissions and audit logging (same oversight
  roles as the Monthly report).
- Unit tests covering the quarter maths and the control logic.

**Frontend (the screen)**
- Added as a third tab — **Quarterly** — on the existing Reports page.
- Shows a responsive bar chart of alerts per month, BP-control summary tiles,
  and a per-patient control table with a plain-language legend.
- A quarter picker (e.g. 2026-Q2) and CSV / PDF download buttons.

**Important:** no database change was required — everything is calculated live
from existing data, so there was no migration.

### 3. Blockers

Only the **BP-control rate** had a blocker. "Under control" needs two decisions
that are clinical judgments, not technical ones:

- **What number counts as controlled?** (e.g. below 140/90, below 130/80, or
  each patient's own provider-set target?)
- **Over what period?** (the patient's most-recent reading, or their average
  across the quarter?)

The **alert-volume trend had no blocker** — it simply reuses the Monthly
report's existing alert-counting, run once per month.

### 4. Decisions taken (the recommended way through the blocker)

The key idea: **don't invent a new clinical number — reuse one the system
already uses.**

| Decision | Choice made | Reasoning |
|---|---|---|
| Controlled cutoff | The **alert engine's existing upper limit (140/90)** as the default | It's already approved; "controlled" = "not in alert territory" — nothing new to sign off |
| Per-patient targets | Use the patient's **provider-set target** when one exists | The system already stores these (PatientThreshold); respects individual plans |
| Time period | The patient's **quarter average** | More stable and fair than a single lucky/unlucky reading for a small group |
| Both numbers | A patient is controlled only if **average systolic AND diastolic** are at/below target | One number being over is enough to be "not controlled" |
| Age | **Ignored for v1** (upper limit only) | The upper limit is the same for all adults; the age-based low-end rule can be added later |

All of this lives in **one configuration block**, so the cutoff is a one-line
change once the official definition is confirmed.

### 5. How the logic works

**Part A — Alert-volume trend**
1. Split the quarter into its three months.
2. Run the existing monthly alert count for each month.
3. Show the three numbers side by side (as a bar chart) plus a quarter total.

**Part B — BP-control rate**
1. Find every patient in the practice who logged at least one BP reading in the
   quarter.
2. For each patient, **average all their readings** → an average systolic and
   average diastolic.
3. Pick that patient's **upper target**: their provider-set value if they have
   one, otherwise the default 140/90.
4. Mark them **Controlled** if average systolic **and** average diastolic are
   both at/below target; otherwise **Not controlled**.
5. Roll up:

```
BP-control rate = (controlled patients) ÷ (patients with readings) × 100
```

### 6. What each column means (per-patient table)

| Column | Means |
|---|---|
| **Status** | Controlled / Not controlled |
| **Average BP** | the patient's average systolic / diastolic for the quarter |
| **Target (upper)** | the upper limit applied (a `*` marks a provider-set target; otherwise it's the 140/90 default) |
| **Readings** | how many BP readings the patient logged in the quarter |

### 7. Worked example

A patient with **46 readings**, averaging **155/71**, target **140/90**:

```
average systolic 155 is above 140  →  Not controlled
(the diastolic 71 is fine, but one number over target is enough)
```

A practice where **2 of 3** patients with readings are controlled:

```
2 ÷ 3 = 0.6667 = 66.67%  →  BP-control rate
```

### 8. Known limitations (important to understand)

- **Average, not most-recent.** Control is judged on the quarter average. A
  formal HEDIS-style measure uses the single most-recent reading instead —
  switching is a one-line change if preferred.
- **Patients with no readings are excluded** from the control rate (they have
  nothing to average), so the rate reflects only patients who logged BP.
- **Upper limit only.** The "too low" end (which differs for older patients) is
  not part of v1; it can be added if wanted.

### 9. What's left for this report
Only the **BP-control definition** in section 4 needs confirmation — the exact
cutoff (140/90 vs 130/80 vs each patient's target) and average-vs-most-recent.
Everything is built around it; confirming it just updates the single
configuration value.

## Task 3 — Alert-Resolution-Time SLA Report

### 1. What it had to do
Produce a **scorecard** that shows, for each type (tier) of alert, how fast the
team is supposed to respond versus how fast they actually did — with a simple
**Pass / Fail** verdict. It answers: *"Are we responding to each kind of alert
within the time we promised?"*

There are two response milestones per alert:
- **Acknowledge** — someone on the care team has seen and picked it up.
- **Resolve** — the alert has been fully closed out.

### 2. What was built

**Backend (the calculation + downloads)**
- A new service that turns the existing monthly numbers into an SLA scorecard.
- Three endpoints: view (JSON), download CSV, download PDF.
- Same permissions + audit logging as the other reports.
- Unit tests covering the Pass/Fail logic.

**Frontend (the screen)**
- Added as a fourth tab — **SLAs** — on the Reports page.
- Two headline tiles (% acknowledged within target, how many tiers are
  failing) and a per-tier table: target vs average, with a Pass / Fail badge,
  for both acknowledge and resolve.
- A month picker and CSV / PDF downloads. The table collapses to cards on
  mobile.

**Important:** no database change, and almost no new calculation — the averages
already existed. This was mostly **presentation** plus one new set of target
numbers (see below).

### 3. Blockers

There were **two**:

1. **The target times are placeholders.** The "respond within X" numbers are
   marked as awaiting clinical sign-off — usable, but not final.
2. **A resolve target did not exist at all.** The system already had
   *acknowledge* targets, but nothing said how quickly an alert should be
   *resolved*. So for the resolve side there was an actual average but nothing
   to compare it against.

### 4. Decisions taken (the recommended way through the blockers)

| Decision | Choice made | Reasoning |
|---|---|---|
| Acknowledge targets | **Reuse the existing ack targets** | Already defined; nothing new to invent |
| Resolve targets | **Add a parallel placeholder set**, derived from each tier's last escalation step (its natural "should be closed by" point) | Sensible default, clearly marked provisional |
| Where the numbers come from | **Reuse the Monthly report's calculation** | Guarantees the SLA figures always match the Monthly report |
| Pass / Fail rule | Pass when the **average** time is at or below target | The task's literal ask; simple to read |
| Extra honesty metric | Also surface **"% acknowledged within target"** | An average can look fine while individual alerts overshoot; the percentage is the more honest number |

Both target sets live in **one configuration block**, so confirming the
official numbers later is a one-line change.

### 5. How the logic works

1. Take the chosen month's alerts, grouped by tier (reusing the Monthly
   report's calculation).
2. For each tier, read its **acknowledge target** and **resolve target**.
3. Compare the tier's **average acknowledge time** to its ack target, and its
   **average resolve time** to its resolve target.
4. Mark each **Pass** (average at/below target) or **Fail** (over target). If
   nothing of that tier was acknowledged/resolved, there's no average to judge,
   so it shows **No data**.

### 6. What each column means

| Column | Means |
|---|---|
| **Alerts** | how many alerts of this tier occurred in the month |
| **Ack target** / **Resolve target** | the promised response time |
| **Mean ack** / **Mean resolve** | the actual average time taken |
| **Ack** / **Resolve** verdict | Pass, Fail, or No data |

### 7. How to read a row (worked example)

```
BP Level 2 | 1 alert | Ack target 15m | Mean ack — (No data) | Resolve target 1h | Mean resolve 5h 10m → Fail
```

This says: one emergency-level alert occurred; it was never formally
acknowledged by a clinician (so no ack average), and although it was resolved,
it took 5h 10m against a 1-hour target → **resolve Fail**.

```
BP Level 1 — High | 4 alerts | Ack target 24h | Mean ack 4h 51m → Pass
```

Four alerts, acknowledged on average in under 5 hours against a 24-hour target
→ **Pass**.

### 8. Known limitations (important to understand)

- **"No data" is common and meaningful.** It means no alert of that tier was
  *acknowledged/resolved by a clinician* in the month (patient self-actions
  don't count). An alert that was resolved without a recorded acknowledgement
  shows up as resolve-data but ack "No data" — worth watching operationally.
- **Pass/Fail is on the average.** A tier can "Pass" on average while a few
  individual alerts badly overshoot. The "% acknowledged within target" tile
  helps balance this.

### 9. What's left for this report
Only the **target times** need confirmation — per tier, the official
*acknowledge-within* and *resolve-within* values. Everything is built around
them; confirming them just updates the single configuration block.

## Task 4 — Per-Condition Cohort Report

### 1. What it had to do
Take the same outcome numbers and **split them by patient condition**, so groups
can be compared side by side. Instead of one practice-wide figure, show a row
per condition (HFrEF, CAD, Pregnancy) plus an "All patients" baseline. It
answers: *"Is one condition group doing worse than another — where should
attention go?"*

### 2. What was built

**Backend (the calculation + downloads)**
- A new service that groups patients by condition and runs the metrics per
  group.
- Three endpoints: view (JSON), download CSV, download PDF.
- Same permissions + audit logging as the other reports.
- Unit tests covering the grouping, overlap, and control-rate logic.

**Frontend (the screen)**
- Added as a fifth tab — **Cohorts** — on the Reports page.
- A comparison table: one row per cohort with patient count, BP-control rate,
  alerts, and an unverified-profile count. The "All patients" baseline row is
  highlighted. Collapses to cards on mobile.
- A month picker and CSV / PDF downloads.

**Important:** no database change. The condition flags and all the metrics
already existed — this is a grouping step on top.

### 3. Blockers

**No hard blocker.** The grouping needs **no new clinical sign-off** — the
condition flags already exist and grouping is just filtering. There were two
**design decisions** (not blockers), each with a sensible default (see §4).

The one inherited caveat: the BP-control rate it reuses still carries the
**provisional 140/90 definition** from Task 2 — but this report adds no new
clinical decision of its own.

### 4. Decisions taken (the recommended way)

| Decision | Choice made | Reasoning |
|---|---|---|
| Overlap | **Cohorts overlap** — a patient with two conditions is counted in each | Clinically honest; avoids arbitrary "which condition wins" rules |
| Baseline | Add an **"All patients" row** | Gives a reference point to compare each cohort against |
| Profile accuracy | **Include everyone, show an "unverified" count** per cohort | Keeps the report complete and honest without hiding data |
| Metrics | **Reuse** BP-control rate + alert counts | No new calculation or clinical decision |

### 5. How the logic works

1. Take every patient in the practice.
2. Tag each with the cohort(s) they belong to, from their profile flags:
   - **HFrEF** → has heart failure of type HFrEF
   - **CAD** → has coronary artery disease
   - **Pregnancy** → currently pregnant
   - **All patients** → everyone (the baseline)
3. For each cohort, run the existing metrics over that group's patients:
   - **BP-control rate** (same average-vs-target logic as the Quarterly report)
   - **Alert count** in the month
   - **Unverified profiles** — how many of the cohort's condition flags aren't
     confirmed yet
4. Show one row per cohort, baseline first.

### 6. What each column means

| Column | Means |
|---|---|
| **Patients** | how many patients are in this cohort |
| **With readings** | of those, how many logged BP (the control-rate denominator) |
| **BP control** | % of those whose average BP is at/below target |
| **Alerts** | alerts raised for this cohort's patients in the month |
| **Unverified** | patients in the cohort whose condition flag isn't confirmed yet |

### 7. How to read it (worked example)

```
All patients | 27 | control 81% | 40 alerts
HFrEF        |  6 | control 50% | 18 alerts | 1 unverified
CAD          |  9 | control 78% | 12 alerts
Pregnancy    |  3 | control 67% |  4 alerts
```

This shows the HFrEF group is controlling BP far worse (50%) than the practice
average (81%) and generating a large share of alerts — a clear signal of where
to focus. (A patient who has both HFrEF and CAD is counted in both rows.)

### 8. Known limitations (important to understand)

- **Cohorts overlap.** A patient with two conditions appears in two rows, so the
  cohort patient counts can add up to more than the total — that's expected.
- **Depends on profile accuracy.** A patient's condition flag can be
  self-reported and not yet confirmed; the "Unverified" column shows how many,
  so a reader can judge how solid each cohort is.
- **Inherits the provisional control definition** (140/90) from Task 2.

### 9. What's left for this report
Nothing specific to cohorts — the grouping is complete. It only inherits the
Task 2 **BP-control definition** confirmation; once that's signed off, this
report updates automatically (same shared setting).
