# ML BP-alert predictor — brainstorming doc

**From:** Nivakaran · **Date:** 2026-07-15 · **Status:** BRAINSTORM — pre-design, pre-commitment
**Scope:** the predictive layer described in the patent doc (`Cardioplace-Patent-Engineering-Answers-Duwaragie.pdf`, 2026-07-13) — an ML layer that sits **alongside and on top of** the permanent deterministic rule engine, adding (a) learned per-patient personalization of the non-emergency thresholds and (b) time-series forecasting for early warning. It never replaces the rule engine.

**What this doc is:** a working draft of the model surface, feature schema, and architecture options. Nothing here is committed. The goal is to have one document that lays out (a) what the ML layer does on top of the rule engine, (b) every field we already store that can feed it, (c) every field we need to add, and (d) the model shapes we'd choose between before scoping the build.

**What this doc is NOT:** a build plan, a design signed off by clinical, or an FDA submission. Those come later.

---

> ## The model, in one paragraph (design basis: the 2026-07-15 review call)
>
> The deterministic rule engine is the **permanent baseline for the general population** and keeps firing every alert, in every tier, forever — it is clinically validated, and it is not migrated, retired, or replaced. On top of it sits an ML layer that does **two distinct jobs**:
>
> 1. **Personalization — a learned per-patient threshold offset.** Once we have enough of a patient's own history (~2-3 months of journaling), the model learns how *this* individual's readings behave and adjusts a **per-user multiplier/offset** on the **non-emergency** thresholds, so the alert that surfaces to them is tuned to their personal baseline rather than the population default. This is a **learned generalization of the personalized mode that already exists in the engine today** (provider-target ± a fixed 20 mmHg, gated on `threshold != null && readingCount >= 7`) — the ML learns the offset from the patient's data instead of using a fixed ±20.
> 2. **Prediction — time-series forecasting for early warning.** From continuous journaling we learn each patient's temporal patterns (day-of-week / seasonal effects, trend) and forecast where their readings are heading, so we can warn **before** the deterministic threshold trips. Two things define the value: **what** we can predict, and **how early**. Predict a deterioration 2 days out → actionable / life-saving; predict it 2 minutes out → too late to matter.
>
> The ML layer never fires an alert the rule engine didn't, and never deletes or replaces a rule-engine code path. It forecasts and personalizes *on top of* the deterministic engine.

## 0 · Architecture — rule engine is the permanent floor; ML is a personalization + prediction layer on top

The ML layer is **future work**. Nothing exists in code today. Two safety facts frame everything:

- **The rule engine fires everything, always.** Every one of the 8 tiers / 56 rules keeps being evaluated and fired by the deterministic engine, for every patient, forever. The ML layer never generates an alert the rule engine didn't, and never suppresses one the rule engine did in a clinically-unsafe direction (see the emergency invariant below).
- **The emergency floor never personalizes.** `BP_LEVEL_2` (SBP≥180 / DBP≥120), `BP_LEVEL_2_SYMPTOM_OVERRIDE`, `TIER_1_ANGIOEDEMA`, and the HR<40 / symptom-override pre-gates are **fixed for every patient regardless of personal history**. No learned offset, no multiplier, no forecast can move them. The worked example from the call — "stable at 200 systolic" — is worth noting here: 200 is *inside* the emergency range, so that exact number would be governed by the non-personalizable floor. The personalization mechanism applies only to the **non-emergency** thresholds (the L1 / Tier-2 / Tier-3 bands).

**Launch order — rule engine first, the model comes in on top once the data exists.** At launch the product ships with **only** the deterministic rule engine firing every alert — there is no ML in the loop at all. The ML layer switches on **incrementally, gated on data collected from the daily check-ins**, not on a release date:

- **System-wide gate (to train the shared models at all):** the three shared services (§4.0.1) need a corpus of daily-check-in history across the enrolled population before there is anything to learn from — the patent doc's rough "several thousand examples" (§14 data-volume). Until the pilot accumulates that, the ML layer stays in shadow / off.
- **Per-patient gate (to personalize *this* patient):** even after the shared models exist, an individual patient's personalization only activates once **that patient** has logged enough of their own history (~2-3 months of journaling / the cold-start reading gate, §14) for their per-patient state (§4.0.1) to be meaningful. Before that, they get pure population rule-engine behavior.

So the sequence is always **rule engine → collect check-in data → model layers on top** — first system-wide (models become trainable), then per patient (each patient's personalization warms up as their own data arrives). The model never precedes the data, and the rule engine never stops firing underneath it (§0b phases).

### 0a · What each layer does, per tier

| Tier | Rule engine (permanent) | ML personalization offset? | ML forecast / early-warning? |
|---|---|---|---|
| `BP_LEVEL_2` | **Fires — authoritative forever** | ❌ never (emergency floor) | Forecast for training-metric only; can't beat a same-reading emergency |
| `BP_LEVEL_2_SYMPTOM_OVERRIDE` | **Fires — authoritative forever** | ❌ never | Same |
| `TIER_1_ANGIOEDEMA` | **Fires — authoritative forever** | ❌ never | Same (acute airway; no leading signal) |
| `TIER_1_CONTRAINDICATION` | **Fires — authoritative** | ⚠️ candidate, Manisha-gated | ✅ days-ahead (adherence-driven) |
| `TIER_2_DISCREPANCY` | **Fires — authoritative** | ✅ candidate | ✅ days-ahead (adherence trend) |
| `BP_LEVEL_1_HIGH` | **Fires — authoritative** | ✅ candidate (learned ±offset) | ✅ 1-3 days (BP drift) |
| `BP_LEVEL_1_LOW` | **Fires — authoritative** | ✅ candidate | ✅ 1-3 days |
| `TIER_3_INFO` | **Fires — authoritative** | ✅ candidate | ✅ days-ahead |

The ML columns are **additive**: they change *what surfaces to whom and when*, not whether the rule engine evaluates the reading.

**Design intent — personalize the *maximum* safe set, not a minimal subset.** The goal is to personalize **every alert it is clinically safe and technically possible to personalize** — all the ✅ rows above are in scope, and `TIER_1_CONTRAINDICATION` (⚠️) is a candidate too once Manisha signs off. The only permanent exclusion is the **emergency floor** (the ❌ rows): it is not personalizable *by definition* — that is a hard safety invariant, not conservatism about everything else. A tier is "possible to personalize" when it has a continuous threshold a bounded offset can shift **or** a learnable per-patient baseline the anomaly detector can hold; those are the targets, and we want coverage across all of them, not a token few. Emergency stays fixed for every patient forever; everything below it, we personalize as far as the governed bounds (§0 invariant 4, §8) allow.

**Non-negotiable safety invariants:**
1. The rule engine remains the authoritative firing mechanism for all 8 tiers. It is never retired or deleted.
2. The ML layer can never fire, or unsafely suppress, an **emergency**-tier alert, and can never move an emergency threshold for any patient.
3. Manisha's clinical inventory of 56 rules is preserved in full. The ML's job is to **personalize the surfacing of** and **forecast** those exact rule-level outcomes — not to redefine or replace them.
4. **The personalization offset only ever operates within provider/Manisha-governed bounds**, and only on non-emergency thresholds. A learned offset that would *loosen* an alert for a patient who is chronically high-but-asymptomatic is the single most clinically fraught idea in this doc — it must be provider-confirmable, must be capped, and must never silently reduce sensitivity below the population floor without sign-off (see §5c / §8).

### 0b · Rollout phases (of the personalization + prediction layer — NOT a migration)

Because the rule engine keeps firing throughout, these are phases of **switching on decision-support**, not of handing authority to ML. There is no "replacement" phase.

| Phase | State | What the patient/provider sees | Rule engine authoritative? |
|---|---|---|---|
| **1 · Shadow** | ML learns per-patient offsets + forecasts; outputs logged for offline evaluation only | Nothing | Yes (as always) |
| **2 · Advisory** | Forecasts + suggested personalization surface to the **provider** as decision-support, alongside the still-firing deterministic alert | Provider dashboard advisory | Yes |
| **3 · Personalization live (non-emergency only)** | Approved per-patient offsets modulate *which non-emergency alerts surface to that patient*; forecasts drive proactive early-warning nudges | Tuned surfacing + early warnings | **Yes — rule engine still fires; ML only tunes surfacing within governed bounds** |

Each phase advances only when it clears the evaluation gates in §9a. **The rule engine is authoritative in every phase** — even at Phase 3, ML is adjusting *surfacing thresholds within limits*, not producing alerts the engine didn't. The patent doc's Q14 ("A v2 prediction would enter only as decision-support") describes Phase 2, and stays true at Phase 3 for the emergency floor.

### 0c · What this means for the reader of this doc

Every "the model predicts X" reference below should be read as: **the rule engine still fires X deterministically; the ML layer (a) forecasts X ahead of time as decision-support and (b), for non-emergency tiers only, tunes whether/at-what-personal-threshold X surfaces to this specific patient.** The ML writes to a runtime advisory / personalization store (a serving artifact holding model *outputs*, not a change to the patient dataset — §3b); it does **not** write `DeviationAlert` rows in place of the engine.

**The emergency layer is untouched by every phase, every version, every retrain.** The ML layer never fires or replaces an alert — it forecasts and personalizes on top of the deterministic engine.

### 0d · The model TYPE — this is a time-series + anomaly-detection system, not an alert-category classifier

**Read this before §1.** The kind of model matters, and it changes how every downstream section (targets, labels, training examples, metrics) should be read:

- The system's job is **time-trend analysis** over each patient's own reading history: plot the readings on a timeline, learn the patient's temporal structure (weekday/weekend, day-of-week peaks, trend, level), and **forecast where the next readings are heading** — *"by looking at his previous data, we can see tomorrow what could be his heartbeat."*
- Alongside the forecaster runs an **anomaly detector** — the server-log pattern: learn the patient's "normal" from history and flag a reading that is deviating / *"going towards the bad side."* Anomaly detection is **unsupervised**; it does not need the disposition label stream.
- The **alert-category classifier** (the 8 tiers / 56 rules) is **not the model** — it is the rule engine's job, which keeps firing. The ML classifier, if built at all, is a *thin secondary head* that maps a forecast to "which tier/rule this is trending toward," so the advisory reads in the provider's existing vocabulary. It is subordinate to the forecaster + detector, not the headline.

**Consequences the rest of the doc must be read through:**
1. **§1's "the model must predict the 56 rules" is the classifier sub-head's target, not the system's primary output.** The system forecasts *readings* and detects *anomalies*; the rule/tier label is a translation layer on top.
2. **§5's disposition-label coverage gap is far less blocking than it first reads.** The forecaster is **self-supervised** (predict the next reading from prior readings — every reading is its own label) and the detector is **unsupervised** (learn normal). Neither needs the clinician-disposition stream, which §5.0 shows only covers 17 of 56 rules. Dispositions matter for *evaluating* whether a forecast/anomaly was clinically useful, not for *training* the two headline jobs.
3. **§9's metrics must include forecasting metrics (interval coverage, MAE/RMSE, time-to-warning) and anomaly-detection metrics (precision@k, detection lead time), not only the classifier metrics (Sens/Spec/PPV/AUC-PR).** See the additions in §9a.
4. **§7's training example is a per-patient time-ordered sequence**, not an IID alert-labeled row — windows of a patient's readings → the next window's forecast, plus the patient's rolling "normal" for the detector.
5. **The online-vs-batch retraining question (§4.0) is live specifically because these model families support it** — a state-space / streaming forecaster or detector can update as readings arrive, which a batch tabular classifier cannot.

---

## 1 · What the ML layer forecasts / detects — and the rule/tier catalog it maps onto

> **Read through §0d:** the headline jobs are **forecasting readings** and **detecting anomalies** per patient. The 8-tier / 56-rule catalog below is (a) what the **rule engine** fires, unchanged, and (b) the label space for the **thin classifier head** that translates a forecast into the provider's existing alert vocabulary. It is not a list of things a supervised classifier must independently learn to fire.

**⚠️ Clinical-scope principle (must be honored by every downstream decision in this doc).**
Every one of the 56 rules enumerated below is a **Dr. Manisha–signed-off clinical alert**. The predictor's target is **all 56 rules across all 8 tiers — none can be dropped, deprioritized, or replaced with a "we'll predict this later" note.** Where this doc discusses training-data limitations (missing dispositions, dead rule-IDs, env-dependent thresholds, known trigger defects) the response is always **"how do we work around the code-level constraint while still predicting the clinical rule"** — never "how do we exclude the rule from the target set." When we say "build HF-decomp advisory first" (§4e) we mean training-data sequencing, not clinical prioritization: all 56 targets are in scope from v1 evaluation onward, even if the earliest-shipped predictors focus on the rules with the richest label streams.

The engine has three orthogonal label axes on every fired alert (`DeviationAlert.tier`, `DeviationAlert.ruleId`, `DeviationAlert.mode`). "Alert category" usually means the tier — the 8-way class — but the model must be able to predict at the finer `ruleId` level too, because different rules within the same tier have completely different clinical actions (a `RULE_HF_DECOMPENSATION` and a `RULE_ORTHOSTATIC_HYPOTENSION` are both `BP_LEVEL_1_LOW`, but the intervention is different).

### 1a · The 8 tiers — coarse prediction targets

| Tier enum | Non-dismissible | Resolvable? | Prediction horizon (target) |
|---|---|---|---|
| `BP_LEVEL_2` | ❌ | ✅ 6 actions | **Hours to ~1 day.** Weakest — BP is sparse-session data. |
| `BP_LEVEL_2_SYMPTOM_OVERRIDE` | ❌ | ✅ 6 actions | **Hours.** Same sparse-data limit; symptom flag is the strong signal. |
| `TIER_1_ANGIOEDEMA` | ❌ | ✅ 6 actions | **Predicted but for retrospective analysis only** — the acute-airway event has no clinically meaningful leading signal in sparse-session data, so the model's prediction cannot precede the deterministic fire in time. Deterministic firing stays 100% authoritative and non-bypassable (patent §Q14). Prediction still runs so we (a) generate a training-time performance metric and (b) never lose the target from the inventory. |
| `TIER_1_CONTRAINDICATION` | ❌ | ✅ 5 actions | **Days** (med + condition contraindication; adherence-driven). |
| `TIER_2_DISCREPANCY` | ✅ | ✅ 5 actions | **Days.** Adherence gaps, missed-dose patterns. |
| `BP_LEVEL_1_HIGH` | ✅ | **❌ NONE** | **1-3 days.** BP drift is trend-detectable. |
| `BP_LEVEL_1_LOW` | ✅ | **❌ NONE** | **1-3 days.** |
| `TIER_3_INFO` | ✅ | **❌ NONE** | **Days.** Physician chart notes; patient education. |

**⚠️ Critical constraint that shapes every training-data decision** — **only 5 of 8 tiers have any resolution actions.** `BP_LEVEL_1_HIGH`, `BP_LEVEL_1_LOW`, and `TIER_3_INFO` (containing **39 of the 56 rules** and almost certainly the majority of alert volume) generate **zero disposition labels**. See §5.0 for how this shapes the label strategy — the "clinician-disposition closed loop" the patent doc calls our strongest asset covers **only 17 of 56 rules**.

**Non-negotiable, restated from the patent doc §7:** predictions never influence the emergency floor. `TIER_1_ANGIOEDEMA` and both `BP_LEVEL_2*` tiers stay deterministic even after the predictor ships. The predictor's role for those tiers is **early-warning decision-support** — an advisory shown to the provider hours before the deterministic threshold trips, not a replacement for the trip itself.

**Restated from §0:** the rule engine fires **all 8 tiers, forever** — nothing is migrated away. The 8 tiers in the table above are the model's **prediction / forecast targets** — the events the model forecasts ahead of time as decision-support, and (for the 5 non-emergency tiers) the events whose *surfacing to a given patient* the learned personalization offset may tune within governed bounds. The model never **produces** a `DeviationAlert` in place of the engine.

### 1b · The 56 rules — the finer targets, grouped by tier

The engine fires one specific `ruleId` per alert. If we want the model to be useful for triage (not just "an alert will fire" but "which specific rule will fire and why"), the model must produce rule-level output — either as its primary target or as an explanation head alongside the tier prediction.

**`BP_LEVEL_2` (2 rules · emergency):** `RULE_ABSOLUTE_EMERGENCY` (SBP ≥ 180 OR DBP ≥ 120), `RULE_PREGNANCY_L2` (pregnant + SBP ≥ 160 OR DBP ≥ 110).

**`BP_LEVEL_2_SYMPTOM_OVERRIDE` (2 rules · emergency-on-symptom):** `RULE_SYMPTOM_OVERRIDE_GENERAL` (any Stage-A red-flag symptom at any BP), `RULE_SYMPTOM_OVERRIDE_PREGNANCY` (pregnant + newOnsetHeadache ∨ ruqPain ∨ edema).

**`TIER_1_ANGIOEDEMA` (2 rules · airway):** `RULE_ACE_ANGIOEDEMA` (swelling on ACE/ARB), `RULE_GENERIC_ANGIOEDEMA` (swelling, no ACE/ARB).

**`TIER_1_CONTRAINDICATION` (4 rules):** `RULE_PREGNANCY_ACE_ARB` (pregnant + ACE/ARB), `RULE_NDHP_HFREF` (HFrEF + non-DHP CCB), `RULE_BRADY_ABSOLUTE` (HR < 40 gated on hasBradycardia ∨ β-blocker), `RULE_UNCONFIRMED_EMERGENCY` (Option-D emergency-range never retaken).

**`TIER_2_DISCREPANCY` (3 rules):** `RULE_MEDICATION_MISSED` (≥2 miss days in 3d OR any β-blocker miss in HF/HCM/AFib), `RULE_BETA_BLOCKER_SOB_HF` (SOB + HF + β-blocker), `RULE_BRADY_SURVEILLANCE` (HR 40-49 asymptomatic when sustained ≥3 days — same rule ID appears in `TIER_3_INFO` when the run is < 3 days).

**`BP_LEVEL_1_HIGH` (13 rules · no disposition possible):** `RULE_STANDARD_L1_HIGH`, `RULE_PERSONALIZED_HIGH` (SBP ≥ provider target + 20), `RULE_PREGNANCY_L1_HIGH`, `RULE_HFREF_HIGH`, `RULE_HFPEF_HIGH`, `RULE_CAD_HIGH` (⚠️ env-dependent — see §7c), `RULE_CAD_DBP_HIGH` (⚠️ env-dependent), `RULE_HCM_HIGH`, `RULE_DCM_HIGH`, `RULE_AORTIC_STENOSIS_HIGH`, `RULE_AFIB_HR_HIGH` (HR > 110), `RULE_TACHY_HR` (HR > 130 severe OR HR > 100 with prior >100 within 8h), `RULE_TACHY_WITH_PALPITATIONS`.

**`BP_LEVEL_1_LOW` (15 rules · no disposition possible):** `RULE_STANDARD_L1_LOW`, `RULE_AGE_65_LOW` (age ≥ 65 SBP < 100), `RULE_PERSONALIZED_LOW`, `RULE_HFREF_LOW`, `RULE_HFPEF_LOW`, `RULE_HCM_LOW`, `RULE_DCM_LOW`, `RULE_AORTIC_STENOSIS_LOW`, `RULE_CAD_DBP_CRITICAL`, `RULE_AFIB_HR_LOW`, `RULE_BRADY_HR_SYMPTOMATIC`, `RULE_HF_DECOMPENSATION` (⚠️ kg/lbs bug fixed 2026-07-14; expect fire-rate to roughly double post-fix), `RULE_ORTHOSTATIC_HYPOTENSION` (⚠️ known defect: "prior reading" has no time bound — rule fires today but on an over-broad definition, still signed off and predicted), `RULE_AFIB_PALPITATIONS`, `RULE_SYNCOPE_GENERAL`.

> **Retracted 2026-07-17.** This list previously carried `RULE_BRADY_HR_ASYMPTOMATIC` as a 16th entry, described as "dead in code today — registered in `RULE_IDS` and the message registry but no rule function emits it… the code gap needs fixing separately", and kept it as a prediction target. That was written on 2026-07-15; on 2026-07-16 the N-7 triage **deleted** the rule outright (commit `128be52`) rather than implementing it — the enum entry and registry entry are gone, so it can never be emitted or labelled. Two docs prescribed opposite remedies for the same gap; the deletion is the one that shipped, and it opens no clinical hole (`CLINICAL_SPEC.md` §5.6 / Q1: HR <40 → `RULE_BRADY_ABSOLUTE`, asymptomatic HR 40–49 → `RULE_BRADY_SURVEILLANCE`). A target the engine cannot emit has no labels to learn from, so it is removed from the inventory here too.

**`TIER_3_INFO` (15 rules · no disposition possible):** `RULE_PULSE_PRESSURE_WIDE`, `RULE_PULSE_PRESSURE_NARROW`, `RULE_LOOP_DIURETIC_HYPOTENSION`, `RULE_HCM_VASODILATOR`, `RULE_DHP_CCB_LEG_SWELLING`, `RULE_BETA_BLOCKER_DIZZINESS`, `RULE_BETA_BLOCKER_FATIGUE`, `RULE_BETA_BLOCKER_SOB_NON_HF`, `RULE_PALPITATIONS_GENERAL`, `RULE_NSAID_ANTIHTN_INTERACTION`, `RULE_ACE_COUGH`, `RULE_HF_CAREGIVER_EDEMA`, `RULE_BRADY_SURVEILLANCE` (when run < 3 days — the same rule appears in `TIER_2` when sustained), `RULE_FIRST_MONTH_ADHERENCE_NUDGE`, `RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL`.

**Totals: 2+2+2+4+3+13+15+15 = 56 slots across 55 rules** (`RULE_BRADY_SURVEILLANCE` spans two tiers). Was 57/56 until `RULE_BRADY_HR_ASYMPTOMATIC` was deleted from code on 2026-07-16 — see the retraction above. Code-level notes that DO NOT change the prediction inventory:
- **2 rules are env-dependent** (`RULE_CAD_HIGH`, `RULE_CAD_DBP_HIGH`) — training-data snapshot must include the effective rollout-phase threshold (see §7c); the rules themselves are in the prediction target set
- **1 rule has a known trigger scope defect** (`RULE_ORTHOSTATIC_HYPOTENSION` — prior-reading time-bound open per Manisha 2026-06-06 sign-off doc) — still fires today, still a prediction target, defect flagged for the rule owner

**All 56 rules are prediction targets. None are dropped.** Where the code doesn't currently fire a rule (dead) or fires it on an over-broad trigger (defect), that's a code-fix work item — the predictor doesn't second-guess Manisha's clinical inventory.

### 1c · Prediction granularity — tier vs. rule vs. hybrid

Three options for what the model actually predicts:

- **Tier-level (8-way):** simpler labels; loses "which specific rule" info the provider needs for triage. Best-suited to advisory tiers where any fire is provider-actionable.
- **Rule-level (56-way):** finer signal but severe class imbalance — some rules fire < 5 times per pilot cohort per month. Requires much more training data.
- **Hybrid (recommended):** primary prediction is the tier (8-way); a rule-explanation head predicts the most likely rule within that tier as a secondary output. Provider sees "L1_HIGH advisory — most likely `RULE_HFREF_HIGH` at 62%." Both the tier probability and the rule probability get calibrated and thresholded independently. Aligns with the multi-tier framing in §4.

**Recommendation for v1:** hybrid — tier-primary, rule-secondary. Rule head produces training signal for future refinement without gating the ship on 56-way class-balance issues.

### 1d · Out of scope for the predictor — signals that look like alerts but aren't

The predictor's target is strictly `DeviationAlert` rows. These other alert-adjacent surfaces are **NOT** prediction targets and must not be conflated with the categorical space above:

| Signal | Model | Why not predicted |
|---|---|---|
| **Patient notifications** (`Notification` model) — daily-reminder cron output, monthly re-ask nudges, N7 "Logged ✓" confirmation pushes | `Notification` | These are scheduled or reactive (patient just logged) — no forecast semantics. |
| **Emergency events** (`EmergencyEvent` model) — voice/chat `flag_emergency` tool fires when patient reports RIGHT NOW severe chest pain / can't breathe | `EmergencyEvent` | Patient-driven emergency assertion — the patient is telling us; no need to predict. Fires the care-team pager directly, bypasses rule engine. |
| **Escalation events** (`EscalationEvent` model) — ladder-step notifications at T+0 / T+4h / T+24h / T+48h | `EscalationEvent` | Deterministic consequences of an alert already firing, not independent events. |
| **Caregiver dispatch logs** (`CaregiverDispatchLog`) | | Downstream of an already-fired alert. |
| **Cluster-6 second-reading prompt** (Manisha 5/9/26) | (UX) | UX cue, not an alert. |
| **Option-D retake prompt** (Manisha 6/12 Q2) | (UX) | UX cue emitted alongside a HELD emergency-range reading; not independently predictable. |

Same principle: the model predicts **whether a DeviationAlert row will be inserted with which tier and (secondarily) which ruleId**. Everything else in the notification / escalation / event stream is out of scope.

### 1e · Do we need new alert categories?

Three candidates worth discussing (all optional, all separate from the deterministic tiers):

- **`PREDICT_HF_DECOMP_IMMINENT` (advisory)** — predicted heart-failure fluid decompensation 2-5 days out (weight slope + edema + missed diuretic). Q1 of the patent doc calls this "the defensible one." Would fire only for HFrEF/HFpEF patients, provider-visible, no patient message.
- **`PREDICT_ADHERENCE_DROP_IMMINENT` (advisory)** — predicted 7-day adherence about to breach target. Provider-only, gives them a lead-time nudge before the deterministic `TIER_2_DISCREPANCY` fires.
- **`PREDICT_BP_DRIFT_TOWARD_L1` (advisory)** — predicted L1 threshold breach in 1-3 days. Provider dashboard only; patient never sees "we think your BP will be high tomorrow" (Manisha would want to review the wording).

All three would be `TIER_3_INFO`-style (physician-visible, non-escalating, non-dismissable-from-patient-side because the patient never sees them). Whether these get their own tier enum values or ride a new `PREDICTED` mode alongside `STANDARD`/`PERSONALIZED` in `AlertMode` is a schema question worth deciding early.

---

## 2 · Features — what we already store that can feed the model

Every field below already exists in Prisma today. Grouped by source table.

### 2a · Per-reading features — `JournalEntry`

Raw signals we capture per BP session (`backend/prisma/schema/daily_journal.prisma`):

| Field | Type | ML use |
|---|---|---|
| `systolicBP`, `diastolicBP`, `pulse` | Int? | Primary numeric signal. |
| `weight` | Decimal? | Daily weight → fluid-trend features. |
| `position` | Position? (SITTING / STANDING / LYING) | Categorical feature; orthostatic pair detection. |
| `medicationTaken`, `medicationScheduledLater`, `missedDoses` | Boolean/Int | Adherence signals. |
| `missedMedications`, `medicationStatuses` | Json | Per-med adherence detail — feature-engineerable per drug class. |
| **Symptom booleans (19 fields)** | Boolean | The "structured symptom report" that Q7 of the patent doc names. |
| `severeHeadache`, `visualChanges`, `alteredMentalStatus`, `chestPainOrDyspnea`, `focalNeuroDeficit`, `severeEpigastricPain` | | Stage-A red-flag symptoms |
| `newOnsetHeadache`, `ruqPain`, `edema` | | Pregnancy / preeclampsia |
| `dizziness`, `syncope`, `palpitations`, `legSwelling` | | Cluster 6 — brady / HF / arrhythmia |
| `fatigue`, `shortnessOfBreath`, `dryCough`, `nsaidUse` | | Cluster 7 — β-blocker / ACE / drug-interaction |
| `faceSwelling`, `throatTightness` | | Cluster 8 — angioedema (do NOT let model near these; deterministic-only) |
| `otherSymptoms` | String[] | Free-text tail. Ignore for v1; NLP-feature later. |
| `notes` | String? | Free-text — same, ignore initially. |
| `measurementConditions` | Json | Pre-measurement checklist (caffeine, smoking, cuff placement, etc.). Useful for reading-quality weighting. |
| `delayBand` | DelayBand enum (REAL_TIME / NEAR_REAL_TIME / DELAYED_ENTRY / HISTORICAL_ENTRY) | Data-freshness feature — historical entries should have downweighted contribution. |
| `narrowPpArtifact` | Boolean | Existing measurement-artifact flag. |
| `singleReadingFinalized` | Boolean | Distinguishes lone reading from session average. |
| `sessionId`, `sessionClosedAt` | String / DateTime? | Group readings into sessions for session-average features. |
| `source` | EntrySource (MANUAL / HEALTHKIT / ADMIN) | Categorical. |
| `measuredAt` | DateTime | Time index for windowing. |
| `createdAt` vs `measuredAt` | | Lag feature (patient discipline). |

**Total per-reading feature count: ~35 raw fields**, expandable via feature engineering.

### 2b · Patient-static features — `PatientProfile`

Once-per-patient features (`backend/prisma/schema/patient_profile.prisma`):

| Field | ML use |
|---|---|
| `gender`, `heightCm` | Demographic. |
| `isPregnant`, `pregnancyDueDate`, `historyHDP` | Pregnancy branch. |
| `hasHeartFailure`, `heartFailureType` (HFREF/HFPEF/UNKNOWN) | Condition branch — HF-specific models. |
| `hasAFib`, `hasCAD`, `hasHCM`, `hasDCM`, `hasAorticStenosis` | Condition branches. |
| `hasTachycardia`, `hasBradycardia` | HR-branch inputs. |
| `diagnosedHypertension` | General HTN branch. |
| `aceContraindicatedAt` (permanent) | Med-safety flag. |
| `profileVerificationStatus` | Data-quality flag — UNVERIFIED features get downweighted. |

**Missing from the profile:** age (there's `dateOfBirth` on `User`), race/ethnicity (not captured — see §5 on fairness), height in some patients (nullable). Structural DB additions needed: see §5.

### 2c · Medication features — `PatientMedication`

Per-drug info (`backend/prisma/schema/patient_medication.prisma`):

| Field | ML use |
|---|---|
| `drugClass` | Categorical — one-hot over 15 classes (ACE, ARB, β-blocker, DHP-CCB, NDHP-CCB, loop diuretic, thiazide, MRA, SGLT2, anticoagulant, statin, antiarrhythmic, vasodilator/nitrate, ARNI, NSAID). |
| `frequency` | Categorical — dosing schedule feature. |
| `verificationStatus` | Data-quality. |
| `holdReason`, `holdSetAt`, `holdEscalationLevel` | Provider-directed hold signals — indicate active clinical concern. |
| `discontinuedAt` | Timeline feature. |
| `isCombination`, `combinationComponents` | Combo-pill flag. |

**Aggregation for the model:** per-patient "drug-class portfolio" one-hots, plus per-active-med `holdReason` presence, plus a per-med `daysOnMed`.

### 2d · Target features — `PatientThreshold`

Provider-set targets (`backend/prisma/schema/patient_threshold.prisma`):

| Field | ML use |
|---|---|
| `sbpUpperTarget`, `sbpLowerTarget` | The clinician's target — deviation from this is a feature. |
| `dbpUpperTarget`, `dbpLowerTarget` | Same. |
| `hrUpperTarget`, `hrLowerTarget` | Same. |
| `setAt`, `replacedAt` | Threshold-recency feature. |

Also the `AlertMode` (STANDARD / PERSONALIZED) that gates whether the ± 20mmHg personalized offset applies.

### 2e · Historical / longitudinal features (derived)

Not stored raw — computed on training-time from the above:

- **Rolling BP statistics** (7-day mean SBP/DBP, 14-day mean, 30-day mean, standard deviations)
- **BP slope over N days** (linear regression on last-N readings' SBP / DBP)
- **Weight slope over N days** (the HF fluid-trend feature — 24h, 3d, 7d, 14d deltas)
- **Weight-delta from baseline** (weight vs. 30-day rolling median — the deterministic `RULE_HF_DECOMPENSATION` uses 24h, we can extend)
- **Adherence rolling %** (3/7/14/30-day windows — matches the existing deterministic rule windows)
- **Session-average vs. session-max/min** (variability within a session)
- **Time-of-day distribution** (mostly-morning vs. spread readings — engagement signal)
- **Missed-dose sequence patterns** (consecutive miss count, weekday vs. weekend pattern)
- **Symptom co-occurrence** (which symptom booleans co-fire; sequence over the window)
- **Cadence features** (readings/week; days since last reading; longest gap)
- **Time-since-last-alert** (per-tier)
- **Time-since-last-disposition** (per-disposition-type)

**All derivable from what we store.** No new fields required for §2e.

### 2f · Label features — `DeviationAlert` (label source)

Every fired alert already carries the fields we need for supervised training (`backend/prisma/schema/diviation_alert.prisma`):

| Field | ML use |
|---|---|
| `ruleId` | Specific rule fired (finer-grained than tier). |
| `tier` | Coarse target class. |
| `mode` (STANDARD / PERSONALIZED) | Which mode was active at fire time. |
| `resolutionAction` | **The disposition — the strongest label signal.** |
| `resolutionRationale` | Free-text — feature engineerable later. |
| `resolutionDetails` | Structured sub-fields (angioedema willGo, ED facility, etc.). |
| `escalated` (Boolean) | Was it acted-on. |
| `status` (OPEN / ACKNOWLEDGED / RESOLVED) | Final state. |
| `acknowledgedAt`, `resolvedAt` | Time-to-resolution feature. |

**The disposition catalog** (from `resolution-actions.ts` — 22 total actions) is the label vocabulary:

| Label class | Dispositions | ML interpretation |
|---|---|---|
| **Positive (real event)** | `TIER1_DISCONTINUED`, `TIER1_CHANGE_ORDERED`, `TIER1_ACKNOWLEDGED`, `TIER2_WILL_CONTACT`, `TIER2_CHANGE_ORDERED`, `BP_L2_CONTACTED_MED_ADJUSTED`, `BP_L2_CONTACTED_ADVISED_ED`, `BP_L2_SEEN_IN_OFFICE`, `ANGIO_ADVISED_ED`, `ANGIO_CONFIRMED_ED`, `ANGIO_ACE_DISCONTINUED`, `ANGIO_SEEN_IN_OFFICE` | Alert was correct; predictor should learn to fire earlier |
| **Negative (false alarm)** | `TIER1_FALSE_POSITIVE`, `TIER2_REVIEWED_NO_ACTION`, `BP_L2_REVIEWED_TRENDING_DOWN`, `ANGIO_FALSE_ALARM` | Alert was wrong; predictor should learn to suppress |
| **Deferred / awaiting outcome** | `TIER1_DEFERRED`, `TIER2_DEFERRED`, `TIER2_PHARMACY_RECONCILE`, `BP_L2_CONTACTED_RECHECK` | Middle-tier clinical judgment — action delayed pending follow-up. Trainable as a weak-positive with lower loss weight, OR relabeled once the follow-up outcome lands in the existing disposition / `resolutionRationale` record. |
| **Unable to reach** | `BP_L2_UNABLE_TO_REACH_RETRY`, `ANGIO_UNABLE_TO_REACH` | Manisha-signed-off operational disposition. Not a clinical true/false judgment on the alert itself — the clinician couldn't get a signal. Used as an **operational feature** (patient engagement, contact-info QA) rather than as the alert's positive/negative training label. |

This label mapping is the single most valuable asset for training — it's what the patent doc calls "the hardest to copy" moat.

### 2g · Outcome-level labels (hospitalizations, ED visits)

Not in the DB today as first-class fields. We know about hospitalizations via the `resolutionRationale` free text or the `ANGIO_CONFIRMED_ED` disposition. Rather than add a dedicated outcome field, v1 extracts hospitalization as a (weaker) label from those **existing** signals — see §3b for why the hard-outcome table is cut.

---

## 3 · Additional fields we need to add to the DB

**Guiding principle: train on the existing dataset; keep new capture to the bare minimum.** The two headline models (§0d) — the self-supervised forecaster and the unsupervised anomaly detector — train and run on the reading time-series **already in `JournalEntry`**, and the classifier head + evaluation use the **existing** disposition catalog (§2f), `AlertStatus`, `escalated`, `acknowledgedAt`/`resolvedAt` timing, and `resolutionRationale` free-text. So the model needs **no new training tables**. The **only** additions we plan are the optional demographic / measurement-context fields in §3a — kept solely because subgroup **fairness auditing** is impossible without them. Everything earlier drafts proposed (a hard-outcome label table, a per-reading confidence column, a "what-changed?" feedback table, wearable streams) is **cut** — see §3b — as either derivable from existing rows or not worth new capture for v1.

### 3a · Demographics + measurement context for fairness auditing (the only additions we keep)

Opt-in, patient-level, low-volume — the only schema additions in scope for v1, and Manisha- + legal/ethics-gated before any migration.

| New field | Table | Type | Why |
|---|---|---|---|
| `raceEthnicity` | PatientProfile | enum? (self-reported, optional) | BP algorithms have documented performance variance across race. Without this we cannot audit subgroup fairness. Must be opt-in and separately-authorized per HIPAA §164.514 designated record set. |
| `arm_circumference_cm` | PatientProfile | Int? | Cuff-size calibration factor; affects reading accuracy across body sizes. |
| `preferred_measurement_hand` | PatientProfile | enum? (LEFT / RIGHT) | Between-arm BP differences are clinically meaningful. |

If ethics/legal decides race/ethnicity is not collectable, fall back to the ZIP-code proxy features other clinical ML shops use — but the explicit field is preferred. These three fields are the **entirety** of the new-capture ask.

### 3b · What we deliberately do NOT add (train on existing data instead)

Earlier drafts proposed the tables/columns below. All are **cut for v1** to keep the data footprint at "existing dataset + the §3a fairness fields."

| Cut addition | Why it isn't needed | What we use instead |
|---|---|---|
| `AlertOutcome` table (hard outcomes: hospitalized / ED visit / med-adjusted / …) | The forecaster (self-supervised) and detector (unsupervised) don't train on outcome labels; only the *optional* classifier head + retrospective evaluation would, and those can start on proxies (§5.0). | Existing disposition catalog (§2f), `AlertStatus` transitions, `escalated`, `acknowledgedAt`/`resolvedAt` timing, and `resolutionRationale` free-text — which already records hospitalizations / ED visits (§2g). |
| `readingConfidenceScore` per-reading column | A data-quality weight is derivable at feature-build time; no need to persist it. | Compute on the fly from the existing `measurementConditions` Json + extreme-value heuristics. |
| `cuffPlacementOk` column | Already captured. | The existing `measurementConditions` Json field — formalize the key at read time. |
| `PredictionMiss` / "what-changed?" table | A feedback-loop *feature* is a nice-to-have, not a training prerequisite, and it adds a new patient-capture flow. | Deferred entirely; if we ever want it, the existing chat/voice pipeline can capture the answer without a dedicated table (§13c). |
| Wearable streams (`ContinuousHrSample`, `ActivityMinutes`, `SleepBlock`) | Out of scope for v1 — the model must work on sparse manual-only data (patent Q4). | Nothing; no wearable ingestion in v1. |

**Net effect:** the model's data footprint is **the existing `JournalEntry` + the disposition/alert fields we already store, plus at most the three optional `PatientProfile` fields in §3a.** No new label table, no new feature table, no new feedback table.

> **Serving/monitoring artifacts are separate from this.** Runtime stores the model writes its *own outputs* to — an advisory/personalization store, a `PredictionLog` audit trail (§10e), a `ModelHealth` drift table (§11a), an optional `PatientFeatureSnapshot` cache (§10d) — are **not** additions to the patient clinical dataset and **not** training inputs. They hold model output, are decided at serving time, and are out of scope for "what data do we collect to train."

---

## 4 · Model architecture

**Restated from §0:** every "model output" below is decision-support written to a runtime advisory / personalization store (a serving artifact, not a new patient-data table — §3b) and surfaced *alongside* the rule engine's `DeviationAlert` — **never** a `DeviationAlert` that replaces the engine's. The rule engine fires; the ML layer forecasts and personalizes on top.

### 4.0 · The model is three cooperating jobs — the classifier is the smallest of them

The classifier options (Options A–D below) treat the problem as "predict which alert category will fire." That is a useful *supporting* job, but the ML layer is really **three cooperating model jobs**, and the classifier is the least important. **These are three shared model *services*, each applied to every patient via per-patient state — not three models trained per patient, and not one monolith (see §4.0.1 for the "how many models / how often to retrain" answer).**

1. **Time-series forecaster (the headline job).** From a patient's continuous journaling, learn their temporal structure (day-of-week / weekend-vs-weekday seasonality, trend, level) and **forecast the next readings** — "by looking at the previous Mondays, we can say tomorrow … the blood pressure will be in this range." This is a forecasting problem (ARIMA / Prophet / state-space / gradient-boosted-on-lag-features / lightweight sequence model), **not** a tabular classifier. It is what delivers the two value axes that matter: *what* we can predict and *how early*.
2. **Personalization-offset regressor.** Learns a per-patient offset/multiplier on the **non-emergency** thresholds from that patient's own history — the learned generalization of the engine's existing fixed ±20 mmHg personalized mode (§0). Output is a bounded per-patient adjustment, provider/Manisha-governed, never touching the emergency floor.
3. **Anomaly detector.** The server-log-style approach: learn a patient's "normal" from history and flag a reading as anomalous / trending toward the bad side — *"anything numerical … we can figure out whether this is going towards the good side or the bad side."* Useful precisely for the tiers with no disposition labels (§5.0), because anomaly detection is unsupervised — it doesn't need the label stream the classifiers depend on.

**A genuinely open question to settle first (record it, don't pretend it's decided): online/streaming learning vs. periodic batch retraining** — *"whether it needs to be constantly trained or whether it can capture trends while it is running."* Time-series/anomaly models can sometimes update their state as data arrives (online) rather than being retrained on a cadence; which regime we pick changes the whole serving + monitoring design (§10, §11). This is a spike to run before committing to an architecture.

**Model-family note:** the patent doc (Q16) picks **gradient-boosted trees** for the *tabular classifier* job because sparse tabular data with missing values is what GBM handles best. That still holds for job (1)'s lag-feature variant and job (2). The forecasting and anomaly jobs may use different model families — pick per job, not one model for all three.

### 4.0.1 · How many models do we train — and how often to retrain (evidence-based)

Two questions the team keeps asking, answered directly so the doc can't be misread.

**Q: Are we training three separate models *per patient*?** **No.** We train **three shared model services** — the forecaster, the personalization-offset regressor, and the anomaly detector — and each is applied to *every* patient through **per-patient state**, not a per-patient artifact.

- **Shared artifacts, per-patient outputs.** There is *one* forecaster artifact (plus possibly a small number of variants — e.g., by signal or forecast horizon, or one global model plus a classical per-series fallback for warm-up), *one* offset regressor, *one* anomaly model. A patient's individuality lives in their **state** — rolling feature window, learned baseline mean/variance, last-update parameters — which is **derived on the fly from the readings already in `JournalEntry`**, **not** stored in a model file trained on that one patient. This is the standard "global model + per-series conditioning" pattern (Salinas et al., *DeepAR*, Int. J. Forecasting 2020): one model learns cross-patient structure and specializes at inference on each series' own history. **No new table is required to hold this state** — materializing it in a dedicated `PredictionState` / snapshot table is an *optional* latency optimization for later (§10c/d streaming-vs-materialized), not a prerequisite. The anomaly detector and forecaster run entirely off existing `JournalEntry`.
- **The count math.** Artifacts to train / monitor / govern ≈ **a handful** (3 families × a few variants), and that count is **constant in the patient population** — *not* `3 × N_patients`. A model-per-patient-file design is operationally intractable at pilot scale (hundreds of patients → hundreds of pipelines, artifacts, and drift monitors) and starves each model of data. The shared-service design is exactly what keeps one training pipeline, one monitoring surface, and one governance path (§10, §11) — the operational reason we chose it.
- **Emergency floor is never a model.** None of the three ever moves the rule engine's emergency thresholds (§0). Personalization is a bounded offset on non-emergency tiers only.

**Q: How often do we retrain — and does "training" even mean the same thing for all three?** Separate two timescales that are easy to conflate:

| Timescale | What updates | Cadence | Cost |
|---|---|---|---|
| **Per-patient state** (inference-time) | rolling window, baseline mean/variance, per-series params | **every new reading** — online / incremental, no training pipeline | negligible (CPU, no GPU) |
| **Shared model artifact** (the actual "retrain") | the cross-patient learned parameters | **periodic batch, drift- and event-gated** (see below) | full pipeline run + eval + promotion |

So "how often do we train the models" is really "how often do we refit the *shared artifacts*" — the per-patient state is maintained continuously and is not itself a training event.

**Evidence-based retraining cadence for the shared artifacts.** There is no universal correct number; the literature is consistent that **fixed-calendar retraining is a floor, and the real trigger is monitoring** (Gama et al., *A survey on concept drift adaptation*, ACM Comput. Surv. 2014; Google Cloud MLOps continuous-training triggers: on schedule, on new data, on performance degradation, on distribution shift). Clinical models specifically degrade under dataset shift if left static — the Epic Sepsis Model's external-validation failure (Wong et al., JAMA Intern. Med. 2021) and Finlayson et al. (*The Clinician and Dataset Shift in AI*, NEJM 2021) are the standing cautionary references. Concrete plan:

- **Trigger, don't just schedule.** Retrain when a §11a drift signal fires (PSI > 0.2 on a critical feature, or > 10% relative AUC-PR drop on the 30-day labeled window) **or** when enough new confirmed events have accumulated — whichever comes first. The **binding constraint is event/label arrival, not the calendar**: dispositions land days after an alert and outcome events (hospitalizations) weeks later (§5, §14 label-latency), so a weekly refit often has too little new signal to justify it.
- **Starting cadence, per service** (defensible defaults, revisited with pilot data — not measured numbers):
  - *Forecaster* — self-supervised, so labels are abundant (every reading is its own target). Global refit **weekly–monthly**; but because its per-patient state already updates online, the global refit is the least urgent of the three. The patent doc's "weekly batch" example is a sensible upper bound here.
  - *Personalization-offset regressor* — needs accumulated per-patient history to move an offset safely; **monthly–quarterly** global refit, with each patient's offset re-derived as their own history grows.
  - *Anomaly detector* — per-patient baseline updates **online** (EWMA / CUSUM-style); the shared parameters (what counts as "anomalous" cross-patient) refit **monthly**.
- **Regulatory frame.** Under FDA SaMD, *uncontrolled* continuous retraining of a deployed model isn't allowed by default — the mechanism to pre-authorize a recurring retrain protocol without a new submission is a **Predetermined Change Control Plan (PCCP)** (FDA final guidance, Dec 2024). Whatever cadence we pick becomes a *pre-specified* protocol, which is a further reason to favor a defined batch cadence + drift gate over ad-hoc online updates of the *deployed artifact*.
- **Feedback-loop guard.** Do not naively retrain the offset/classifier on dispositions the model itself influenced — that creates the feedback loop Adam et al. (*Hidden Risks of ML Applied to Healthcare*, MLHC 2020) document, where the model degrades while looking healthy. Retrain against the self-supervised forecast targets and the randomized/holdout stream (§9d), not only on post-deployment dispositions.

**Is there a theory that gives us the number? No — there is theory for the *mechanism* and evidence for the *prior*.** Worth stating plainly so nobody mistakes "monthly" for a derived result:

- **Theory gives the trigger, not the cadence.** Concept-drift theory (Gama et al. 2014) holds that the optimal adaptation rate depends on the **drift rate** — which is unknown and non-stationary. The principled answer is therefore *detect, don't schedule*. The formal detectors are where the actual math lives: **ADWIN** (Bifet & Gavaldà, SDM 2007) gives adaptive windowing with **provable bounds** on false-positive/negative drift detection; **DDM** (Gama et al. 2004) and **CUSUM / Page-Hinkley** are the classical sequential change-detection baselines. Online-learning regret theory adds the *shape* of the trade-off (achievable tracking depends on how fast the optimum moves), and the windowing bias-variance tension is real (shorter window = fresher but noisier) — but both need the drift rate we don't have a priori. **No theorem yields "every N days."**
- **Evidence gives the prior.** Clinical models measurably drift on a **months** timescale — calibration drift in clinical prediction models is documented (Davis et al., *JAMIA* 2017, AKI models), alongside the Wong 2021 / Finlayson 2021 degradation references above. That is what makes **monthly** a defensible *starting prior* rather than an invented number.
- **The honest gap — "monthly" is a literature prior, not a Cardioplace measurement.** We have **zero drift telemetry**, because nothing is deployed. The evidence-based path is: instrument drift detection (§11a) from **day one of shadow**, measure *our* drift rate on *our* data, and let that set the cadence. **The cadence is an output of the telemetry, not an input we guess now** — the observed firing rate of the detector is what tells us the real cadence.
- **Drift detected ≠ full retrain — recalibrate first.** The model-updating literature finds that for a drifted clinical model, **recalibration often recovers most of the lost performance without a full refit**. So the response is a two-step, not one: **recalibrate (cheap, frequent) → full refit only if recalibration doesn't recover the metric** (expensive, governed, PCCP-gated). A single blunt "retrain cadence" throws this away. See §11a for the response ladder.

**Bottom line for the doc:** three shared services, ~a handful of artifacts total (not one, not one-per-patient); per-patient behavior comes from per-patient *state* updated online on every reading; the shared artifacts adapt on a **drift-triggered basis with a conservative scheduled floor** — recalibrate first, refit only if that fails, **start from a monthly prior (forecaster up to weekly)**, gated on §11a drift signals and confirmed-event volume, and formalized as a PCCP. **The cadence is measured, not decreed:** once shadow telemetry exists, the detector's firing rate replaces the prior. The one thing still genuinely undecided is whether the *global artifact itself* also updates online (streaming) vs. pure batch — that is the §4.0 spike, and it changes only the shared-artifact row of the table above, never the per-patient-state row.

### The classifier options (the "which tier / rule" supporting job)

The options below are the design space for the **classifier** job — useful for the advisory ("most-likely rule within the forecasted tier") and for turning a forecast into a tier label. The patent doc (Q16) picks **gradient-boosted trees**: sparse tabular data with lots of missing values is exactly what GBM handles best. What varies is **how many models** and **how their outputs combine**.

### Option A — Single multi-class classifier over all tier labels

```
[feature vector] → [XGBoost multi-class] → P(tier = t) for each t in {L1_HIGH, L1_LOW, TIER_2, TIER_3, HF_DECOMP_ADVISORY, ...}
```

**Pros:** simplest to build, one training pipeline, one model to deploy, one calibration curve. Low ops overhead.

**Cons:** every tier competes with every other; imbalance hurts rare classes (L2 emergencies are ~1% of alerts). Tier 3 informational events drown out the important L2 signal. Can't tune per-tier precision/recall tradeoffs independently.

**Best for:** first prototype ("does this work at all?"), not for production.

### Option B — Per-tier binary classifiers, run in parallel

```
[feature vector] → [XGBoost binary: L1_HIGH?] → P(L1_HIGH)
                → [XGBoost binary: L1_LOW?]  → P(L1_LOW)
                → [XGBoost binary: TIER_2?]  → P(TIER_2)
                → ... (one binary per tier)
```

**Pros:** each tier's precision/recall tunable independently — you can accept higher recall for HF-decomp advisory (miss = bad outcome) while keeping tight precision on Tier 2 (spam = fatigue). Class imbalance is handled per-model (per-class threshold, per-class SMOTE / weighted loss). Easy to add / remove one tier without retraining the others.

**Cons:** N models to train, deploy, monitor, and version. Feature-engineering pipeline still shared, but N inference calls per patient per prediction cadence. Harder to enforce "at most one tier fires per patient per day" — needs a post-hoc arbitration layer (see §4e).

**Best for:** production if we have the ops budget.

### Option C — Two-tower (slow vs. fast horizon)

Duwaragie's Q16 recommendation: split by **event horizon**, not tier.

```
[feature vector] → [Slow tower: XGBoost, horizon=days]   → P(HF_DECOMP), P(ADHERENCE_DROP), P(BP_DRIFT)
                → [Fast tower: XGBoost, horizon=hours]   → P(BP_L2_EARLY), P(L1_BREACH_NEAR)
                → [Arbitration layer]                    → Combined output
```

**Pros:** matches the actual physics — HF fluid trends develop over days (weight signal is daily-cadence), BP excursions are hours-scale. Each tower gets the features aggregated at the right window (slow tower sees weekly features; fast tower sees last-6-hours features). Explicit horizon = better interpretability ("the system predicted HF decomp 3 days out").

**Cons:** need to define the arbitration policy (when slow says stable + fast says trouble, which governs?). Two towers still each need per-tier heads inside them (so it's really 2 × N binaries) — architectural overhead > Option B unless you collapse related tiers.

**Best for:** production once we have enough labeled data to justify per-horizon feature engineering.

### Option D — Hierarchical (gate → tier-specific specialist)

```
[feature vector] → [Gate model: is anything abnormal in the next 7 days?]
                    │
                    ├─ NO  → done (background rate ~90% of patient-days)
                    │
                    └─ YES → [Specialist model per predicted-abnormal-branch]
                              │
                              ├─ [BP-branch specialist] → tier + horizon
                              ├─ [HF-branch specialist] → tier + horizon
                              └─ [Adherence specialist] → tier + horizon
```

**Pros:** most inference calls short-circuit at the gate (patient is stable → no downstream work). Specialists can be small and per-branch, each trained on the pre-filtered abnormal set (better positive-class density). Matches how clinicians think.

**Cons:** two-stage error compounding — a false-negative at the gate blocks every specialist. Gate must be tuned for very high recall (miss nothing) at the cost of precision, which reintroduces the imbalance problem the specialists were supposed to solve.

**Best for:** later refinement once we have a large enough dataset that a gate-vs-no-gate ablation is even meaningful.

### 4e · Recommendation for the v1 build — what to switch on first

**All 56 rules stay rule-engine-fired from day one; nothing is "migrated" away.** This section is about **which forecast / personalization to turn on first as decision-support** (§0b Phase 2→3), not about handing firing authority to ML. Sequencing is gated by data availability, horizon confidence, and the §9a metrics.

**Model-job sequencing (per the §4.0 reframe):**

1. **HF-decompensation forecast** (Q1's "defensible one") — small feature set (weight slope + edema + missed diuretic), longest horizon, clearest label from disposition + hospitalization outcome. First forecast to reach Phase 2 advisory. The rule engine's `RULE_HF_DECOMPENSATION` keeps firing underneath; the ML adds days-ahead early warning.
2. **Adherence-drop forecast** — the deterministic 7-day adherence rule already fires; ML forecasts the breach 3-7 days ahead as a provider nudge. `RULE_MEDICATION_MISSED` stays authoritative.
3. **BP-drift forecast → advisory on `BP_LEVEL_1_HIGH` / `BP_LEVEL_1_LOW`** — the time-series job's sweet spot (trend over 3-7 days); these two tiers are 39 of 56 rules and the highest-volume surface where personalization pays off. Rule engine still fires L1; ML forecasts the approach and (Phase 3) applies the learned per-patient offset to *surfacing*.
4. **Personalization-offset on non-emergency BP tiers** — once a patient has ~2-3 months of history, switch on the learned offset (bounded, provider/Manisha-governed) so chronically-stable patients aren't over-alerted and rising-trend patients are tightened. **Emergency thresholds excluded.**
5. **Anomaly detection on the label-poor tiers** (`TIER_3_INFO`, L1) — unsupervised, so it works where the disposition label stream doesn't reach (§5.0). Useful as an early, low-cost signal while the supervised forecasts mature.

**Emergency tiers: forecast for metrics only, never personalize.** `BP_LEVEL_2`, `BP_LEVEL_2_SYMPTOM_OVERRIDE`, and `TIER_1_ANGIOEDEMA` are forecast in shadow purely to (a) track a training-time metric and (b) accumulate the evidence Rengan needs for the patent's *"prediction beneath a non-bypassable emergency floor"* thesis. The rule engine fires them, unmodified, for every patient, forever. No offset, no suppression, no ML-authored fire — the §0 safety invariant.

**Phase-advance criteria (all must hold; no "replacement" phase exists):**
- **Shadow → Advisory:** forecast AUC-PR / interval-coverage ≥ target for 4 consecutive weeks; ECE ≤ 0.05; no per-subgroup regression.
- **Advisory → Personalization-live:** provider prediction-rating ≥ 60% "useful" over 8 weeks; PPV in the deployment population ≥ Manisha's threshold; and — for any tier where a learned offset would change surfacing — **explicit Manisha sign-off on the offset bounds** for that tier. The rule engine remains authoritative in this phase; only *surfacing within governed bounds* changes.

### 4f · Multi-model arbitration (when several binaries fire at once)

Option B and Option C both produce N per-tier / per-horizon outputs that may fire simultaneously for the same patient on the same day. Without an arbitration rule the provider dashboard risks alert fatigue — the exact spam problem the disposition-label loop exists to solve.

Design options for the arbitration layer:

- **Highest tier wins, ties broken by earliest horizon** — safest, matches how clinicians think about emergency > urgent > informational. Cost: loses lower-tier signal that might be independently actionable.
- **Show a bundled card** — surface all fired predictions on one row (e.g., "HF advisory + adherence-drop advisory for patient X") so the provider sees co-occurring signals without N notifications. Cost: UI complexity, requires design.
- **Confidence-thresholded suppression** — only show predictions where the model's calibrated confidence > τ. τ tuned per-tier from the false-alarm budget. Cost: requires reliable calibration (see §11a).
- **Provider-configurable digest cadence** — per-provider setting: "show these advisories continuously" vs. "batch me a morning digest." Cost: state to maintain, another config surface.

**Recommendation for v1:** highest-tier-wins + confidence-thresholded suppression + bundled card in the dashboard when co-occurring. Digest cadence deferred to v2.

**Note the interaction with the deterministic engine:** if the deterministic engine already fired an alert for this patient today, the model's advisory for the same tier should be suppressed (or shown as "already alerted"). Otherwise the provider sees the deterministic and the predictive as if they were two independent events.

---

## 5 · Label engineering — dispositions as an EVALUATION signal, not the primary training label

> **Per §0d — how labels apply to each model job.** A supervised classifier *needs* a label per example. The two headline jobs don't:
> - the **time-series forecaster is self-supervised** — the label for "predict the reading at t+1d" is simply the actual reading at t+1d, which every journaling patient generates for free;
> - the **anomaly detector is unsupervised** — it learns each patient's "normal" with no labels at all.
>
> So the disposition catalog below is mainly how we **evaluate** whether a forecast/anomaly was *clinically useful* (did the drift we predicted lead to a clinician action?), and how we train the **thin classifier head**. It is *not* a blocker on training the forecaster or detector. Read the coverage gap in §5.0 with that in mind — it constrains the classifier head and the outcome-evaluation, not the headline models.

The disposition catalog gives us the label vocabulary for the classifier head + evaluation. Four things need explicit design decisions.

### 5.0 · The disposition-coverage gap (constrains the classifier head + evaluation, NOT the forecaster/detector)

Per §1a, **only 5 of 8 tiers have any resolution actions.** `BP_LEVEL_1_HIGH`, `BP_LEVEL_1_LOW`, and `TIER_3_INFO` — containing **39 of 56 rules** — generate **zero disposition labels** because [resolution-actions.ts:233](backend/src/daily_journal/escalation/resolution-actions.ts#L233) returns `[]` for those tiers. Providers see the alert, dismiss it, and no `resolutionAction` is ever written.

**Why this is less severe than it looks under the §0d model type:** the forecaster and detector don't consume dispositions to train, so they cover all 8 tiers' *readings* regardless of label coverage. Dispositions only limit (a) the classifier head's vocabulary accuracy on the 39 label-poor rules, and (b) our ability to *retrospectively confirm* a flagged drift was real. The **existing** weak-proxy labels (§3b) and the anomaly detector's unsupervised coverage are the mitigations — the detector is in fact the recommended first signal on exactly these label-poor tiers (§4e step 5).

**What this means for training data:**

| Prediction target | Disposition label available? | Alternative label source |
|---|---|---|
| Tier 1 Contraindication (4 rules) | ✅ 5 actions per alert | Direct disposition |
| Tier 1 Angioedema (2 rules — never predicted) | ✅ 6 actions | Direct disposition |
| Tier 2 Discrepancy (3 rules) | ✅ 5 actions | Direct disposition |
| BP Level 2 emergency (2 rules) | ✅ 6 actions | Direct disposition |
| BP Level 2 symptom-override (2 rules) | ✅ 6 actions | Direct disposition |
| **BP Level 1 HIGH (13 rules)** | **❌ zero** | Weak proxy: `AlertStatus` (OPEN → ACKNOWLEDGED → RESOLVED), `escalated` flag, ack/resolve timing, plus hospitalization inferred from existing `resolutionRationale` (§2g) |
| **BP Level 1 LOW (16 rules)** | **❌ zero** | Same weak-proxy set |
| **Tier 3 INFO (15 rules)** | **❌ zero** | Same weak-proxy set + "was the patient's next reading normal" outcome proxy |

**Consequences the doc must own:**

1. **The strongest label signal covers only 17 of 56 rules (~30%).** Every claim about "the disposition-label closed loop is our moat" (patent doc Q10) needs this footnote.
2. **The three low-coverage tiers are almost certainly the majority of alert volume.** So the majority of training examples must be labeled from weaker signals — status transitions, escalation lifecycle, outcome inference — none of which is as clean as a clinician-written disposition.
3. **The label-poor tiers lean on the forecaster/detector, not a new outcome table.** Because the forecaster is self-supervised and the detector unsupervised, the L1/Tier-3 *readings* are covered without dispositions. A classifier head on those rules leans on the **existing** weak proxies (status transitions, escalation lifecycle, `resolutionRationale` outcome inference) — v1 does **not** add an `AlertOutcome` table (§3b).
4. **The unblock isn't ML — it's product.** Adding a disposition catalog for L1 and Tier 3 (even a small one like `L1_REVIEWED_NO_ACTION` / `L1_CONTACTED_PATIENT` / `L1_MED_ADJUSTED`) would 3× the label coverage. Suggest this as a product proposal to Manisha independent of the ML build.

### 5a · Label-latency handling

Dispositions arrive **days after** the alert fires (clinicians resolve on their next shift). Hard outcomes (hospitalization) can arrive **weeks** later. Training window must terminate at `now − label_latency_max` (e.g., 14 days) or the last N% of the training set is unlabeled and biases the model.

**Design decision needed:** how much label latency do we accept? Longer = more signal but slower retrain cadence.

### 5b · Label imbalance

Rough distribution from the alert taxonomy (56 rules, 8 tiers):
- **Tier 3 (informational):** ~60% of alerts
- **Tier 2 discrepancy:** ~30%
- **BP L1 high/low:** ~8%
- **Tier 1 contraindication:** ~1.5%
- **BP L2 emergency:** ~0.5%
- **Angioedema:** <0.1%

Per-model binary classifiers (Option B) handle this with class-weighted loss or minority oversampling. Multi-class (Option A) needs stratified sampling and per-class threshold tuning post-hoc.

### 5c · Deferred / awaiting-outcome dispositions

`TIER1_DEFERRED`, `TIER2_DEFERRED`, `BP_L2_CONTACTED_RECHECK`, `TIER2_PHARMACY_RECONCILE` are Manisha-signed-off dispositions where the clinician has taken action but the outcome hasn't landed yet (deferred to next visit, awaiting pharmacy reconciliation, awaiting a recheck). They're neither clean positives nor clean negatives at the moment they're recorded — they resolve to one later. Handling options for training:
- **Weak-positive with lower loss weight** — treat as a soft positive signal; the model learns that the alert was actionable enough to warrant a follow-up
- **Delayed relabel** — pair with the eventual outcome recorded in the existing disposition / `resolutionRationale` follow-up (hospitalization, med change, resolved-no-action) once it arrives; retrain against the resolved label
- **Held out of the initial positive/negative pool** — kept in the training data as a distinct third class with its own loss weight, never dropped from the label vocabulary

**Recommend for v1:** delayed relabel where a follow-up outcome is recorded in the existing fields; weak-positive treatment otherwise. Both preserve the Manisha-signed-off disposition in the label vocabulary — the model always sees the disposition, the only question is how it's weighted for the positive/negative axis.

### 5d · Inter-rater reliability

Different clinicians may disposition the same alert differently. Without a periodic second-clinician sample (say, 10% of alerts double-reviewed), the label stream has undocumented noise. Suggest adding a `secondaryDispositionByUserId` optional field on `DeviationAlert` and a routing rule that flags a small random % for second review. Costs one extra clinician minute per flagged alert; buys defensible label quality for the training set.

---

## 6 · Feature-to-alert mapping matrix

Which features matter for which prediction target. `⭐` = primary signal, `·` = supporting signal, blank = not relevant.

| Feature group | HF decomp advisory | Adherence drop | BP drift → L1 | BP L2 early | Tier 2 discrepancy | Tier 1 contraindic. |
|---|---|---|---|---|---|---|
| Weight slope (24h/7d) | ⭐ | | · | | · | |
| Weight-delta from baseline | ⭐ | | | | | |
| `legSwelling`, `edema`, `shortnessOfBreath` | ⭐ | | | | | · |
| `missedMedications`, `medicationTaken` history | · | ⭐ | · | | ⭐ | |
| Rolling BP mean (7d/14d) | · | | ⭐ | ⭐ | | |
| BP slope over 3-7d | | | ⭐ | ⭐ | | |
| Per-session BP variability | | | · | ⭐ | | |
| Position + orthostatic delta | | | · | · | | ⭐ |
| Cluster 6 symptoms (dizziness / syncope / palpitations) | · | | | ⭐ | | ⭐ |
| Cluster 7 symptoms (fatigue / SOB / dryCough / NSAID) | ⭐ | | | | · | ⭐ |
| Reading cadence (readings/week) | · | ⭐ | · | | ⭐ | |
| Drug-class portfolio | ⭐ | ⭐ | · | · | ⭐ | ⭐ |
| `holdReason` presence | | ⭐ | | | ⭐ | ⭐ |
| Condition flags (`hasHF`, `hasCAD`, etc.) | ⭐ | · | ⭐ | ⭐ | · | ⭐ |
| Target-deviation vs. `PatientThreshold` | | | ⭐ | ⭐ | | · |
| Days-on-med / med recency | · | ⭐ | | | ⭐ | ⭐ |
| Time-since-last-alert (same tier) | · | · | · | · | · | · |
| Prior disposition history | · | · | · | · | · | · |
| Delay-band distribution | | · | · | · | · | |

**Read the columns, not the rows:** for each prediction target, ⭐ = mandatory input, · = candidate that should be evaluated but might be pruned.

---

## 7 · Training-example construction

> **Per §0d — example shape by model job.** The alert-labeled row below is the **classifier-head** example. The two headline jobs use time-ordered examples:
> - **Forecaster (self-supervised):** an example is a **per-patient window** — `[patient's readings from t−W … t]` → **target = the actual reading(s) at t+h** (for horizons h = 1d, 3d, 7d). No alert label needed; the future reading *is* the target. Slide the window along each patient's timeline to generate many examples per patient.
> - **Anomaly detector (unsupervised):** an example is the patient's **rolling "normal"** (distribution/model of their prior readings) plus the new reading to score. No label at all; the detector flags deviation from the learned normal.
>
> Both must respect the temporal splits in §9c (no future leakage) and the label-latency terminus in §5a for any outcome-based evaluation. The alert-labeled structure below remains correct for the classifier head.

### 7a · Example structure (classifier head)

For each candidate alert (positive or negative), an example is:

```
{
  patientId,
  eventTimestamp,           # when the alert would fire (real or hypothetical)
  features: {
    static: { … from PatientProfile at eventTimestamp … },
    active_meds: [ … PatientMedication rows active at eventTimestamp … ],
    threshold: { … PatientThreshold active at eventTimestamp … },
    per_reading_recent: [ … last N JournalEntry rows within horizon-window … ],
    derived: { …rolling means, slopes, cadence, etc.… }
  },
  label: {
    tier | 'NO_ALERT',
    ruleId,
    disposition,            # from DeviationAlert.resolutionAction
    outcome,                # from existing disposition / resolutionRationale if available
    outcomeAt
  }
}
```

### 7b · Negative examples and positive-example weighting

**Negative examples:** every day the patient logged a reading and NO alert fired. This is the class-imbalance driver — most days are quiet. Use temporal negative sampling (sample uniformly across patient-days without alerts) to prevent the model from overfitting to the alert-only distribution.

**Positive-example weighting:** examples with a hard outcome label (hospitalization — inferred from the existing `resolutionRationale` / `ANGIO_CONFIRMED_ED` signals, §2g) get higher weight than examples with only a `TIER1_ACKNOWLEDGED` disposition.

### 7c · Pipeline short-circuits and env-dependent labels — training-data caveats

The rule engine is a **fixed-order pipeline with hard short-circuits**, not a set of independent classifiers. Every training example must be labeled with awareness of these caveats or the model will learn control-flow artifacts rather than clinical reality.

**Emergency exclusivity.** Once any rule claims the `emergency` axis ([alert-engine.service.ts:846](backend/src/daily_journal/services/alert-engine.service.ts#L846)), Stages C and D never run. A `BP_LEVEL_1` or `TIER_3` label is **structurally impossible** alongside an emergency label on the same reading. Training implication: the label distribution is conditional on the pre-emergency features — a model trained on "predict L1_HIGH" is implicitly modeling "predict L1_HIGH given no emergency also fired." Do not train a model to predict Tier-3 without gating on the absence of a same-reading emergency.

**First-claimant-wins on each axis.** An HFrEF patient at SBP 88 gets `RULE_HFREF_LOW`, never `RULE_STANDARD_L1_LOW` — purely from iteration order in `axisRules`. Training implication: rule-level labels for the standard-vs-condition-specific pairs are correlated with `hasHeartFailure` / `hasCAD` / etc. via the pipeline, not via clinical reasoning. A rule-level model must either (a) predict the tier and let the condition flag disambiguate downstream, or (b) explicitly include the iteration order as a feature (bad — brittle).

**Five gates produce zero alerts regardless of vitals** ([alert-engine.service.ts](backend/src/daily_journal/services/alert-engine.service.ts)):

| Gate | Line | Effect |
|---|---|---|
| `HISTORICAL_ENTRY` (delayBand ≥ 24h) | `:385` | No L2 fires; excluded from CMS 99454 count |
| Newer entry exists (backfill) | `:401` | This entry is a backfill; alerts wouldn't fire |
| Option-D terminal (UNCONFIRMED/CONFIRMATORY) | `:784` | Pair-resolution logic already fired |
| AFib patient with < 3 session readings | `:802` | AFib gate demands 3-reading session |
| Single-reading non-emergency | `:862` | Cluster-6 Q2 requires session-average, not lone reading |

Training implication: every negative example must be checked against these gates. A patient-day where the reading was gated (e.g., an AFib patient on their first session reading) is **NOT** a clean negative — the engine never even evaluated it. Recommend including a `gate_reason` feature so the model can learn the difference between "we evaluated and found nothing" and "we couldn't evaluate."

**CAD rules are env-dependent (still full prediction targets).** `RULE_CAD_HIGH` and `RULE_CAD_DBP_HIGH` thresholds depend on `process.env.CAD_THRESHOLD_ROLLOUT_PHASE` and `CAD_ROLLOUT_START`. The rules stay in the target set; the label extraction handles the env-dependency:
1. **CAD labels are not reproducible from patient features alone** — the same feature vector can produce different labels at different points in the rollout. Include the effective-CAD-threshold as a feature at training time, snapshotted at label time.
2. **Historical training data crosses rollout phases.** Segment the training set by rollout phase so within-phase consistency holds; combine phases at inference time.

**`hrUpperTarget` / `hrLowerTarget` are inert today (code gap, not a clinical scope reduction).** Providers edit these in the admin UI; the DB stores them; no rule reads them. Training implication: the `PatientThreshold` HR fields are a **feature** the model can use (provider intent signal). Do not construct an "HR-target deviation" feature that pretends the engine acts on it — but the fields themselves are legitimate model inputs, and the underlying provider intent should eventually drive a rule. Open ticket for the rule owner.

**`DeviationType.WEIGHT` is unreachable.** The enum value exists; no rule sets it. Exclude from any type-based feature or label — this is a schema cleanup item, not a clinical inventory decision (weight-based rules like `RULE_HF_DECOMPENSATION` still fire; they just don't set this specific enum value).

**`RULE_BRADY_HR_ASYMPTOMATIC` was deleted, not fixed** *(retracted 2026-07-17)*. This section previously read "dead in code… the rule remains a prediction target… opening a code ticket to fire the rule per Manisha's original spec is a prerequisite for producing training data". The opposite happened: the N-7 triage removed the rule from `RULE_IDS`, the message registry and the engine on 2026-07-16 (`128be52`), because HR <40 had already been superseded by `RULE_BRADY_ABSOLUTE` (Tier 1, Manisha 2026-05-10) and asymptomatic HR 40–49 by `RULE_BRADY_SURVEILLANCE`. It is therefore **not** a prediction target: nothing can emit it, so no label can ever exist. No code ticket is needed.

---

## 8 · Safety gates (non-negotiable, per Q14 + Q17 of the patent doc)

Any deployment of the ML layer must satisfy these gates. They exist independent of the model architecture chosen, and they hold **through every rollout phase in §0b** — the rule engine is authoritative in all of them.

1. **Emergency-tier floor — never touched.** ML outputs never influence `BP_LEVEL_2`, `BP_LEVEL_2_SYMPTOM_OVERRIDE`, or `TIER_1_ANGIOEDEMA` alerts in any phase, ever — no forecast, no personalization offset, no suppression. The rule engine's emergency short-circuit runs first and remains authoritative for these 3 tiers forever. This is the doc's single most-important invariant.
2. **Provider-confirmable before it acts** — the ML layer is decision-support. A forecast is an advisory; a personalization offset only changes non-emergency *surfacing* and only within Manisha-approved bounds after provider confirmation. The ML never fires an autonomous alert to the patient and never writes a `DeviationAlert` in place of the engine.
3. **Never loosens the emergency threshold** — the learned personalization offset applies to non-emergency thresholds only, and even there may only *loosen* within a Manisha-approved cap (it may tighten freely). It can never suggest suppressing or relaxing a rule-engine emergency alert for any patient.
4. **Cold-start policy** — new patient (< N days of history) uses population prior weighted by condition + demographic bucket. The predictor's confidence must decay with data density and be shown in the UI as such.
5. **Fairness gate** — before every retrain, evaluate per-subgroup performance (race/ethnicity if we collect it, otherwise age/gender/condition). If any subgroup's AUC degrades > threshold from the prior model, block promotion.
6. **Model-explainability required** — every model prediction shown to a provider must include the top-N contributing features (SHAP or equivalent). No "the model says so" without evidence.
7. **Shadow-mode gate** — new model runs in shadow (logs predictions, compares to actuals) for M weeks before it's allowed to influence provider dashboards. FDA SaMD framework expects this.
8. **Uncertainty / abstention** — every model needs a "I don't know" output for out-of-distribution patients (rare condition combinations, extreme demographics, patients with atypical feature vectors). Options: confidence-thresholded suppression (only show predictions above τ), calibrated probability + explicit "low-confidence" badge, per-patient distance-from-training-distribution flag. Deferred abstention (route to human-in-the-loop review instead of firing) is safer than automatic suppression for the high-stakes tiers.
9. **Physician override tracked as first-class label** — when a provider sees the model's advisory and disagrees, that disagreement is itself training signal. Requires a UI mechanism (§15) and a schema field distinct from disposition (a disposition resolves an alert; an override marks the model was wrong about firing at all).

---

## 9 · Evaluation & benchmarking

Answers "how do we know the model is actually good?" before it ships and after.

### 9a · Metrics — split by model job (per §0d), prevalence-disclosed, CI-reported

**⚠️ Metrics must match the model type (§0d).** The classifier metrics that dominate this section (Sensitivity/Specificity/PPV/NPV/AUC-PR) measure the **thin classifier head** — "did we call the right tier." They do **not** measure a forecaster or an anomaly detector. Report all three families:

**⚠️ Every "Target" number below is an illustrative placeholder with no clinical authority — see §9e for the method that replaces them with clinically-derived numbers (measure the achievable frontier → elicit Manisha's harm:benefit ratio via Decision Curve Analysis → constrain by the alert-fatigue budget → lock as PCCP acceptance criteria).**

**(A) Forecasting metrics — the headline job (time-series).**

| Metric | What it means | Target (placeholder — tune with Manisha) |
|---|---|---|
| **Interval coverage** (e.g. does the 80% prediction interval contain the actual reading 80% of the time?) | The forecast's honesty — a forecast without calibrated uncertainty is unusable for a clinician | Empirical coverage within ±5% of nominal |
| **MAE / RMSE on forecasted SBP/DBP/pulse/weight** at each horizon (t+1d, t+3d, t+7d) | How close the point forecast is, per signal per horizon | Report per signal + horizon; beat the persistence baseline (§9b) |
| **Time-to-warning distribution** (median + 10th/90th pct) | the "how early" axis — the value is in the lead time, not just the hit | Longer is better; the tail matters (see Tier-2 metrics) |
| **Directional / trend accuracy** ("did we correctly call whether the next reading rises, falls, or holds?") | The "good side vs. bad side" trend call | > persistence + seasonal-naïve baselines |

**(B) Anomaly-detection metrics — the unsupervised job.**

| Metric | What it means | Target |
|---|---|---|
| **Precision@k / alerts-per-patient-week** | Of the anomalies we surface, how many were clinically real — and how many per patient (the alert-fatigue budget) | Per-tier alert budget, Manisha-set |
| **Detection lead time** vs. the deterministic fire | How far ahead of the rule-engine fire the anomaly flagged the drift | Days for slow signals (weight/HF); hours for BP |
| **False-alarm rate per patient-time** | The direct fatigue metric for an unsupervised detector | Bounded per patient-week |
| **AUROC/AUC-PR against the *eventual* disposition/outcome** where a label later exists | Ties the unsupervised flag back to a clinical outcome when one arrives | Report where labels land (label latency, §5a) |

**(C) Classifier-head metrics — the secondary translation job.** The Tier-1/2/3 tables below. These gate the *advisory-vocabulary* accuracy ("we said L1_HIGH-trending; was it?"), not the forecast or the detector.

**Universal rules that apply to every metric below:**
- Computed and reported **per-tier separately** (never single global number — tier prevalence spans two orders of magnitude, from Tier 3 at ~60% to BP L2 at ~0.5%)
- Reported with **95% confidence interval** (bootstrap n≥1000 for AUC-PR / PPV; analytical for calibration)
- Annotated with the **base-rate prevalence** used to compute it — a Brier of 0.15 on a base rate of 0.005 is nearly perfect; the same 0.15 on 0.6 is barely better than random
- Specified with **unit of analysis** (per-alert / per-patient-day / per-patient-week / per-patient-month — different units produce different numbers)
- Distinguished by **lifecycle stage** — training-time CV, held-out test set, post-deployment monitoring have different baselines

#### Tier 1 — Ship-gate metrics (must-hit for provider-visible promotion)

These are the metrics Manisha and the FDA reviewer read. Fail any of them per tier, the model doesn't ship to providers for that tier.

| Metric | What it means clinically | Target (placeholder — pilot-tune with Manisha, do NOT treat these numbers as signed off) |
|---|---|---|
| **Sensitivity ≥ X at Specificity ≥ Y** | "Catches X% of true events while keeping Y% of quiet days quiet." Threshold-dependent — Manisha sets the operating point | HF advisory: Sens ≥ 0.7 at Spec ≥ 0.85 (illustrative); BP L2 early-warning: Sens ≥ 0.4 at Spec ≥ 0.99 |
| **PPV (Positive Predictive Value)** in the target deployment population | "Of the advisories the model produces, what fraction are useful to a clinician." Depends on prevalence — MUST be reported in the deployment population, not training | Per-tier — provider budget. Illustrative: HF PPV ≥ 0.3, BP L1 drift PPV ≥ 0.2 |
| **NPV (Negative Predictive Value)** at the operating threshold | "When the model says stable, how often is the patient actually stable." Critical for the null-advisory case where the model's silence is itself the decision | Per-tier — high (0.95+) for advisory tiers |
| **Expected Calibration Error (ECE) ≤ 0.05** | "When the model says 70%, it happens between 65-75% of the time." Enables confidence-thresholded suppression (§4f) and provider trust | 0.05 absolute at the operating threshold, per tier |
| **Per-subgroup PPV within 5% absolute of overall** (or absolute floor) | Fairness gate. No demographic subgroup silently underperforms | 5% absolute (stricter than 10% relative for clinical use) |
| **Number Needed to Alert (NNA) ≤ N** | "Clinician reviews N advisories to catch one true event" — the direct clinical-utility metric | Per-tier — illustrative: HF ≤ 5, BP L1 ≤ 10, Tier 2 ≤ 15 |

**Cost-sensitive framing.** A false negative on `HF_DECOMP_ADVISORY` costs a hospitalization (~$25k + patient harm); a false positive costs 60 seconds of provider review. Loss function during training must reflect the asymmetry — class-weighted loss or post-hoc threshold optimization on a validation set with the cost matrix applied. Not a metric itself, but the operating-threshold choice depends on it.

#### Tier 2 — Development / benchmarking metrics (report every version, don't block promotion)

Used for model iteration and cross-version comparison. Reported in every experiment log; used to answer "is v2 better than v1?" — not "is v2 shippable?"

| Metric | Purpose |
|---|---|
| **AUC-PR** (with bootstrap 95% CI) | Threshold-independent overall performance for imbalanced classes. Primary training-time metric |
| **AUC-ROC** (with 95% CI) | Secondary; useful for cross-model comparison but misleading at extreme imbalance |
| **Brier score + log-loss** | Proper scoring rules combining calibration and refinement. Complementary — Brier weights errors quadratically, log-loss weights them multiplicatively |
| **Reliability diagram** (per tier, per subgroup) | Visualizes calibration; catches systematic over/underconfidence that ECE alone can hide |
| **Decision Curve Analysis** (net benefit across threshold range) | Standard clinical-ML metric (Vickers 2006). Weighs threshold-dependent benefit vs. harm. Required for FDA + medical publication |
| **Time-to-warning distribution** (median, IQR, 10th percentile, 90th percentile) | Median alone hides the tail. If the 10th percentile is 6 hours but the median is 3 days, half the value comes from short-horizon predictions — worth knowing |
| **Precision-recall curve** at every threshold | Enables operating-point selection; visualized in every retrospective analysis |
| **Concordance index (C-index)** | If any tier is framed as time-to-event (survival analysis alternative — see §14), C-index is the standard |

#### Tier 3 — Diagnostic metrics (drill-down when Tier 1 fails)

Not shipped as headline numbers; used to explain a failure and guide the fix.

| Metric | When to use |
|---|---|
| **Confusion matrix by patient subgroup** | When per-subgroup PPV fails — identifies which subgroup |
| **Calibration curves stratified by tier + subgroup** | When ECE fails at aggregate — reveals whether miscalibration is uniform or subgroup-specific |
| **Feature-importance stability across CV folds** (SHAP variance) | When AUC-PR is unstable across folds — indicates the model isn't learning stable structure, likely under-trained or data-leaky |
| **Per-rule (not just per-tier) precision/recall** | When tier-level sensitivity passes but a specific rule under-performs (e.g., `RULE_HFPEF_HIGH` alone catches < 40% while other L1_HIGH rules catch 70%) — points at which rule needs feature-engineering work |
| **Learning curve** (metric vs. training-data volume) | When metrics plateau below target — distinguishes "data-hungry" from "model-capacity-limited" |
| **Time-to-warning by patient subgroup** | When median time-to-warning is fine but subgroup analysis reveals it's driven entirely by one patient bucket |

#### Unit-of-analysis specification (every metric report names its unit)

| Unit | Use when |
|---|---|
| **Per-alert** (numerator = fired alerts, denominator = candidate predictions) | Reporting per-tier precision/recall for cross-model comparison |
| **Per-patient-day** (numerator = patient-days with any advisory shown) | Alert-fatigue metric ("advisories per patient per day"). Direct measure of provider burden |
| **Per-patient-week** (numerator = patient-weeks with an advisory) | Provider-facing cadence metric ("how often do I see something for this patient") |
| **Per-patient-month** (numerator = patient-months) | Long-horizon outcomes (hospitalization rate, adherence % delta) |

**Metrics cannot be compared across different unit-of-analysis choices — always disclose the unit.** A "false-alarm rate of 0.5" means nothing without knowing whether that's per-alert (potentially fine), per-patient-day (probably too high), or per-patient-week (excellent).

#### Prevalence disclosure template

Every metric report includes the row: **"Base-rate prevalence in evaluation set: P (95% CI: [lo, hi])."** Without this, no metric interpretation is possible.

Example correct report:
> `RULE_HF_DECOMPENSATION` advisory — post-deployment monitoring, week of 2026-08-14
> - Base-rate prevalence: 1.2% per patient-week (95% CI 0.9-1.6%)
> - Sensitivity: 0.72 (95% CI 0.65-0.79) at Specificity 0.87 (0.84-0.90)
> - PPV: 0.34 (0.27-0.41), NPV: 0.98 (0.97-0.99)
> - NNA: 3 (95% CI 2-4)
> - ECE: 0.038
> - Unit of analysis: per-patient-week

Anything short of this is not a metric report — it's a hunch.

### 9b · Baselines to beat

The model isn't useful unless it beats simpler alternatives. Baselines split by model job (§0d):

**Forecaster (the headline job) must beat these value-forecasting baselines** — this is where a time-series model earns its keep:
1. **Persistence** — "tomorrow's reading = today's reading." The bar every forecaster must clear.
2. **Seasonal-naïve** — "next Monday = last Monday" (the day-of-week structure from the call). If the model can't beat seasonal-naïve, it hasn't learned the patient's temporal pattern.
3. **Drift / linear-trend extrapolation** — extend the recent slope. Cheap; often hard to beat at short horizons.

**Anomaly detector must beat:**
4. **Fixed-threshold on the raw signal** (i.e., the rule engine itself, which fires at 0 lead-time) — the detector must flag the drift *earlier* than the deterministic threshold trips, at an acceptable false-alarm rate.
5. **Simple statistical control chart** (e.g., z-score vs. the patient's rolling mean/SD) — the classic anomaly baseline; a learned detector must beat it to justify the complexity.

**Classifier head must beat:**
6. **Random** (per-tier base rate) and **"predict last-day's tier"** persistence.

If a model doesn't beat its job's top baseline by a meaningful margin, ship the baseline — a seasonal-naïve forecaster or a control chart is a perfectly respectable v1.

### 9c · Temporal splits, not random splits

Standard k-fold cross-validation is wrong for time-series clinical data — it leaks future information into training. Use:

- **Forward-chaining split** — train on months 1-6, validate month 7, train on 1-7 validate 8, etc.
- **Held-out patient split** — some patients are entirely held out to test generalization to new individuals (matters for cold-start §12).
- **Held-out condition split** — occasionally, hold out an entire condition cohort (e.g., all HFpEF patients) to test transferability.

### 9d · A/B / champion-challenger deployment

Once a new model version is trained, it doesn't replace the champion overnight. Progression:

1. **Shadow mode (weeks 1-4):** challenger predicts alongside champion; both logged; only champion surfaces to providers. Compare per-tier metrics.
2. **Silent A/B (weeks 5-6):** 10% of patients see challenger's outputs, rest see champion. Provider blind to which model produced which advisory. Compare disposition patterns.
3. **Gradual rollout (weeks 7-8):** 50% split; monitor per-subgroup metrics.
4. **Promotion or rollback:** if challenger wins per-tier + no subgroup regression, promote to champion. If any subgroup regresses, rollback and log why.

Every promotion needs a documented owner + rationale — this is the model-registry requirement (§11c).

### 9e · How we set the accuracy thresholds (the method — every number in §9a is a placeholder)

Every "Target" in §9a is an **illustrative placeholder with no clinical authority**. This section is the method for replacing them. Two principles drive it: **you cannot set a target before you know what is achievable**, and **we do not set the clinical trade-off — Manisha does.** We supply the frontier and the statistics; she supplies the judgment.

**Step 1 — Measure the achievable frontier first (in shadow).** Run the models in Shadow (§0b Phase 1) and plot, per tier, the precision-recall / ROC frontier and the forecast-error curve against the §9b baselines. Picking a sensitivity target before seeing the frontier is how teams end up with a number no model can hit — or one so lax it certifies nothing. **No target is signed off until we can show the frontier it sits on.**

**Step 2 — Elicit the clinical trade-off as a ratio, not as a metric.** Clinicians cannot meaningfully answer *"should sensitivity be 0.7?"* — but they can answer **"how many false alarms would you review to catch one true decompensation?"** That question is the formal instrument behind **Decision Curve Analysis** (Vickers & Elkin, *Med Decis Making* 2006 — already a Tier-2 metric): the answer *is* the threshold probability `p_t` at which acting and not-acting are equally attractive, and it maps directly onto a point on the Step-1 frontier.
- *"I'd review 5 unnecessary HF advisories to catch 1 real one"* → NNA ≤ 5 → `p_t ≈ 0.2` → read Sensitivity/PPV off the frontier at that threshold.
- This is exactly how the illustrative *"HF: Sens ≥ 0.7 at Spec ≥ 0.85"* gets **replaced** by a number with a clinical derivation behind it.

**Step 3 — Constrain by the alert-fatigue budget (a capacity fact, not a statistic).** Independent of what is statistically optimal, the care team can only review so many advisories per week. Convert staffing into a hard cap — **alerts-per-patient-week ≤ B**, Manisha/ops-set. If the DCA-optimal threshold exceeds `B`, **`B` wins**: an advisory nobody reads has zero net benefit. In remote-monitoring deployments this is the constraint that most often binds.

**Step 4 — Apply the asymmetric cost matrix post-hoc.** The §9a cost framing (a false negative on HF ≈ a hospitalization + patient harm; a false positive ≈ ~60 seconds of review) is encoded as a cost matrix, and the operating threshold is optimized **on a validation set** — not guessed at training time. Report the chosen point's **net benefit** against DCA's two reference strategies ("alert on everything" / "alert on nothing").

**Step 5 — Enforce the floors that hold regardless of the optimum.**
- **Beat the §9b baseline** for that job — or ship the baseline instead.
- **Per-subgroup PPV within 5% absolute** of overall. A threshold that only works for the majority subgroup is not a threshold.
- **ECE ≤ 0.05.** On a miscalibrated score a "0.2 threshold" is not 0.2 of anything — calibration is a precondition for threshold-setting to mean anything.
- **Emergency tiers are exempt** — nothing here gates them; the rule engine fires them regardless (§0).

**Step 6 — Lock the result as pre-specified acceptance criteria.** FDA expects acceptance criteria fixed **before** validation, not retuned afterward until something passes. Once Manisha signs the operating point it is frozen into the **PCCP** (§4.0.1); later movement is a documented change with a rationale, not a quiet retune.

**"Accuracy threshold" is not one thing — it differs per job:**

| Job | What the threshold actually *is* | How it gets set |
|---|---|---|
| **Forecaster** | Not a probability cut. Calibrated **interval coverage** (±5% of nominal) + **MAE/RMSE beating persistence & seasonal-naïve** by a margin + **lead time long enough to act on** | Frontier vs. §9b baselines + Manisha's answer to *"how early is early enough to change management?"* |
| **Anomaly detector** | The **false-alarm budget** per patient-week (Step 3); lead time is then an *outcome*, not a knob | Capacity cap first, measure achieved lead time at that cap |
| **Classifier head** | The classic operating point (Sens / Spec / PPV) | DCA threshold probability (Step 2) + cost matrix (Step 4) |

**Ownership:** we own the achievable frontier and the statistics; **Manisha owns the clinical trade-off** — the harm:benefit ratio, the alert budget, and "how early is actionable." The PCCP locks it. We never invent a clinical threshold; we present the frontier and ask the trade-off question.

---

## 10 · Deployment, serving, and inference cadence

Answers "where does the model run, when does it predict, and how does its output reach the provider?"

### 10a · Where the model runs

Two architectural choices:

**Option 1 — In-process alongside NestJS backend.** Load model on boot into node-native runtime (via ONNX Runtime for Node, or shell out to a Python worker via child_process). Predict inline as part of the existing `AlertEngineService` pipeline.
- **Pros:** low latency (no network hop), simple deploy (one artifact), easy access to already-loaded patient context.
- **Cons:** couples model updates to backend deploys, forces Node-compatible model runtime (ONNX Runtime is fine for GBM; harder for anything else).

**Option 2 — Separate Python inference service.** Deploy the model behind a small FastAPI or gRPC service; backend calls it over HTTP/internal AWS VPC.
- **Pros:** independent deploy cadence (retrain → redeploy service without touching backend), Python-native tooling for eval, feature engineering, and model versioning.
- **Cons:** network hop (adds 20-100ms per prediction), one more service to run, requires internal-only network security (already have AWS BAA perimeter).

**Recommendation:** Option 2 for anything beyond the first prototype. The independent deploy cadence and native Python tooling dominate the latency cost, especially since predictions aren't on the request path — they're on a background evaluation trigger.

### 10b · When we predict — inference cadence

| Trigger | Frequency | Rationale |
|---|---|---|
| **New JournalEntry created** | Real-time on `ENTRY_EVALUATED` | Same event the deterministic engine listens to; predictor evaluates in parallel |
| **Nightly full sweep** | Once daily per enrolled patient | Catches patients who didn't log today but have stale features that now cross a threshold |
| **On-demand from provider dashboard** | When provider opens patient chart | Fresh prediction with latest context; avoids showing stale advisory |
| **On threshold change** | When `PatientThreshold` updates | Predictions depend on target-deviation features; must recompute |
| **On medication change** | When `PatientMedication` add/discontinue/hold | Med-portfolio features change; predictions must be recomputed |

**Idempotency requirement:** the same patient + same input state must produce the same prediction. No random-seed variation between runs. Predictions cached per (patientId, feature-vector-hash) for 30 min to avoid duplicate compute on rapid re-triggers.

### 10c · Inference latency budget

Per-prediction budget: **under 200ms end-to-end** (feature fetch + model.predict + persist). Justification:
- Real-time on entry: sits alongside deterministic engine which fires in ~50ms; providers expect similar responsiveness
- Nightly sweep: batchable, so per-patient cost less critical
- Dashboard on-demand: users tolerate ~500ms for a chart load

Feature-fetch will dominate — the 30-day rolling window queries `JournalEntry` for hundreds of rows. Precompute the derived features into a materialized `PatientFeatureSnapshot` table refreshed nightly (or on-write, decide from load).

### 10d · Feature pipeline architecture

Two computation modes to consider:

1. **Streaming (compute on demand):** Every prediction call reads raw rows, computes rolling features. Simple, always fresh, but expensive per call.
2. **Materialized snapshot:** A `PatientFeatureSnapshot` table holds precomputed features. Refreshed by a cron (nightly + on-write). Predictions read the snapshot. Fast, but adds a refresh path to test.

**Recommendation for v1:** streaming compute for the first 6 months. Migrate to materialized snapshots only if the p95 latency exceeds the 200ms budget. Premature optimization otherwise.

### 10e · Model versioning

Every prediction row must record `modelVersion` (e.g., `hf-advisory-v2.1.3`). This enables:
- Retroactive analysis of "which model made this call"
- Champion-challenger comparison (§9d)
- Regulatory audit trail (FDA SaMD)
- One-click rollback (§11d)

Recommend a `PredictionLog` table — a **serving/audit artifact** for the model's own outputs (not patient clinical data, not a training input; §3b) — with `modelId`, `modelVersion`, `patientId`, `alertId?`, `predictionType`, `probability`, `featureVectorHash`, `predictedAt`.

---

## 11 · Monitoring, drift detection, and rollback

Answers "how do we know when the deployed model is degrading, and what do we do about it?"

### 11a · Drift detection

Three drift types to monitor continuously:

1. **Feature drift** — the input distribution changes (e.g., new patient cohort has different age distribution, new drug added to formulary). Detect via per-feature population-stability-index (PSI) or Kolmogorov-Smirnov test between current 7-day window and training-set baseline. Alert threshold: PSI > 0.2 on any critical feature.
2. **Prediction drift** — the model's output distribution shifts. Detect via KS test on predicted-probability histograms between current and prior window. Prompts investigation, not necessarily rollback.
3. **Performance drift** — labels are arriving; measured metrics differ from training-time. Recompute per-tier AUC-PR on the past 30 days of dispositions vs. training-set AUC-PR. Alert threshold: > 10% relative drop.

All three drift signals write to a `ModelHealth` table and trigger a Slack/email alert to the model owner. None of them auto-rollback — the human-in-the-loop reviews before demoting.

**Detection latency differs by signal — this is what forces a scheduled floor.** Not all drift is observable at the same speed, and the difference drives the retrain design (§4.0.1):

| Signal | Needs labels? | Detectable within |
|---|---|---|
| **Feature drift** (PSI / KS on inputs) | ❌ no | **Immediately** — as the input distribution shifts |
| **Forecaster error drift** (MAE / interval-coverage degradation) | ❌ no — self-supervised; the next reading *is* the label | **~1–7 days** — as fast as the forecast horizon |
| **Anomaly-detector false-alarm-rate drift** | ❌ no — measurable from surfaced-flag volume | **Days** |
| **Classifier-head performance drift** (AUC-PR drop) | ✅ **yes** | **Lags by label latency** — dispositions days later, outcomes weeks later (§5a) |

Two consequences:

1. **The forecaster monitors itself.** Because it is self-supervised, its ground truth arrives with the next reading — we can see forecast error climbing within a day or two, with **no clinician, no disposition, and no label latency**. The headline model's drift is observable in near-real-time; the classifier head's is not.
2. **The classifier head is structurally blind for days-to-weeks.** We can only detect its degradation *after* its labels land. This is precisely why §4.0.1 keeps a **conservative scheduled floor** underneath the detection trigger — detection is primary, the schedule is the backstop covering the blind window.

**Response ladder for a fired drift signal — recalibrate before refitting.** A drift alert does **not** automatically mean "retrain the artifact":

1. **Recalibrate** (cheap, fast) — for a drifted clinical model, recalibration often recovers most of the lost performance. Try this first.
2. **Full refit** — only if recalibration doesn't restore the metric. Expensive, governed, PCCP-gated (§4.0.1).
3. **Rollback** — if neither recovers it (§11d).

Log **which step resolved each drift event** in `ModelHealth`. The distribution of "recalibration sufficed" vs. "needed a refit" is itself the evidence that sets our real retrain cadence over time (§4.0.1 — the cadence is an output of this telemetry, not a number we guessed).

### 11b · Prediction-vs-outcome dashboard

A permanent internal dashboard showing per-tier per-week:
- Predictions made (count)
- Positive dispositions on predicted-positive alerts (true-positive proxy)
- Predictions where no alert eventually fired (false-positive proxy — noting label latency)
- Provider-override rate (see §14)

Ownership: whoever owns the model (Duwaragie or a future ML engineer). Reviewed weekly. Anomalies documented in a runbook.

### 11c · Model registry

A canonical store for every trained model version: model artifact + training-data snapshot ID + evaluation metrics + fairness-subgroup breakdown + owner + promotion decision + rollback link. Options:
- **MLflow** (open-source, self-hostable, standard)
- **Weights & Biases** (paid, richer experiment tracking)
- **DIY** (S3 bucket + a Postgres model_versions table) — cheapest, viable for < 10 models

**Recommendation:** MLflow self-hosted for v1. Cheap, standard, portable.

### 11d · Rollback plan

Every deployed model has a documented rollback:
1. Model registry stores every prior version
2. One config flag (`ACTIVE_MODEL_VERSION`) switches which version the inference service loads at next restart
3. Rollback takes ≤ 5 minutes (config change + service restart)
4. Post-rollback: mandatory retrospective, documented in the runbook

Never delete an old model version — versions are the audit trail.

### 11e · Prediction-explainability logging

Every surfaced prediction persists its top-N contributing features (SHAP values or GBM per-tree contribution). Enables:
- Provider trust ("why did the model say this?")
- Post-hoc analysis of failure modes
- Regulatory audit (§8 gate 6)

Storage cost is small (top-10 features per prediction; ~200 bytes). Add to `PredictionLog`.

---

## 12 · Cold-start & new-patient handling

Answers "what does the model do for a patient with almost no history?" — the DEFAULT case at enrollment.

### 12a · The problem

At enrollment, a patient has:
- 0 JournalEntry rows
- 0 DeviationAlert rows
- Possibly 0 verified PatientMedication rows
- Only the intake profile (condition flags, demographics)

Rolling features (30-day mean BP, weight slope, adherence %) are undefined. The predictor can't run.

### 12b · Strategy: population prior → transition to individual baseline

Three-phase approach:

1. **Phase 1 — Onboarding (days 0-7, < 7 readings):** predictor uses only static features (condition flags, demographics, med portfolio) against a population prior. Prior is a lookup table: "for HFrEF female age 65-75 on beta-blocker + loop diuretic, base-rate probability of each tier over next 30 days is P." Table computed once from the training-set aggregate. Very rough, but calibrated to the cohort.

2. **Phase 2 — Bootstrapping (days 7-30, 7-30 readings):** predictor uses static features + short-window rolling features (7-day mean, no trends yet). Predictions are shown but flagged "low-confidence — insufficient history" in the dashboard.

3. **Phase 3 — Steady state (> 30 days, > 30 readings):** full-feature predictor. Confidence badge removed.

Phase-transition gates (readings-count thresholds) tuned from pilot data — the 7 / 30 numbers are starting points, not defended.

### 12c · New-condition-diagnosis handling

Special case: an existing patient gets a new diagnosis (e.g., HF just added). Their historical readings pre-date the diagnosis — do they count for the new HF-specific predictor?

Two options:
- **Include:** the past readings show pre-diagnosis behavior; useful signal.
- **Exclude:** the past readings were under a different rule regime; may bias.

**Recommendation:** include, but flag with a `preDiagnosisReading=true` feature so the model can learn to weight them differently.

### 12d · Rapid condition change

When a patient's condition set changes materially mid-session (e.g., pregnancy confirmed, HF diagnosed, new AFib), the personalized-mode gate `threshold != null && readingCount >= 7` still applies — but the feature engineering may need reset. Options: reset the rolling-window origin at condition-change events (feature version bumped). Adds bookkeeping; worth doing only if signal justifies it.

---

## 13 · Provider feedback loop — beyond dispositions

Dispositions are the strongest label source but they're indirect ("this alert was a false alarm" ≠ "the model was wrong to predict"). Two extra signal channels close the loop.

### 13a · Explicit prediction rating

When a provider sees a predictive advisory, offer a two-click rating:
- 👍 Useful
- 👎 Not useful (with 1-click reason: `NOT_CLINICALLY_RELEVANT`, `TOO_LATE`, `ALREADY_KNEW`, `NOISY`)

This is a **future enhancement, not a v1 schema change.** If built, ratings would live on the model-output side (tied to `PredictionLog.id`), not in the patient dataset, and count as a soft label. Explicit `TOO_LATE` ratings would recalibrate the horizon target.

### 13b · Physician override tracking

Distinct from disposition (which resolves a fired alert), an override marks the model was wrong to fire in the first place. UI: "Suppress this advisory type for this patient" checkbox on the prediction card, with a required 1-sentence rationale.

Overrides feed the training loop as **strong negative examples** — the provider is saying "for this patient, this advisory pattern is a false alarm." Aggregate override rates per predictor become a health metric (§11).

### 13c · The "what-changed?" prompt (patent §Q11)

§3b cuts the dedicated `PredictionMiss` table. Restating the mechanism here as a **possible future** feedback loop (no new table — captured through the existing chat/voice pipeline if revived):

When a prediction fires but no alert eventually materializes (predicted-positive → observed-negative after horizon window elapses), surface a lightweight patient-facing prompt via the existing chat/voice pipeline: "Hi Aisha, we thought your readings might go a bit high this week and they didn't — anything change? (medication tweak, diet, activity, illness)". Free-text + structured choices. The answer could feed a future retrain as a derived feature — captured through the existing chat/voice pipeline, no dedicated table needed.

The infrastructure already exists — the voice pipeline has patient context + tool-dispatch. Only the prompt copy + retrain wiring is new work.

---

## 14 · Open questions (things to decide before scoping the build)

- **Do we need FDA clearance before the predictor is provider-visible?** SaMD Class II likely. Timeline impact: months for De Novo pathway. Talk to Rengan.
- **Label-latency window:** how long do we wait for dispositions before an example is "trainable"?
- **Retrain cadence:** answered in §4.0.1 — shared artifacts refit on a drift- and event-gated batch cadence (start monthly, forecaster up to weekly), formalized as a PCCP. Still open: whether the *deployed global artifact* also updates online (streaming) vs. pure batch — the §4.0 spike.
- **Cold-start reading-count gate:** the deterministic personalized-mode gate is 7 readings — the ML predictor's gate should probably be higher.
- **Model versioning + rollback path:** who approves a new model version's promotion, and what's the one-click rollback if a live model misbehaves?
- **Data volume estimate:** the patent doc's Q17(e) says "realistically several thousand examples" needed. When does pilot enrollment reach that? Track it explicitly.
- **Race/ethnicity capture:** legal + ethics need to sign off on collecting this for fairness auditing. If they refuse, name the ZIP-code proxy plan.
- **What-changed prompt (future feedback loop, Q11):** deferred — no dedicated table in v1 (§3b). If revived: what triggers the ask? Every missed prediction? Every unexpected event? The retention hit of over-asking is real.
- **Alert-arbitration policy** (Option B / Option C): when multiple binaries fire, which surfaces? Highest tier wins; ties broken by most recent signal?
- **Where does the model run?** In-process alongside the deterministic engine, or a separate service? First option is simpler for latency but couples deploys.
- **Product proposal: add L1 + Tier-3 disposition catalog?** §5.0 shows disposition labels cover only 17 of 56 rules. Adding a minimal disposition set (`L1_REVIEWED_NO_ACTION` / `L1_CONTACTED_PATIENT` / `L1_MED_ADJUSTED`, and analogous for Tier 3) would 3× the label coverage. This is a product decision for Manisha, but the ML case for it is very strong.
- **Tier-vs-rule prediction granularity** — §1c recommends hybrid (tier-primary, rule-secondary head). Confirm before committing to the model architecture.
- **How do we handle the CAD env-dependency for label extraction?** CAD rules (`RULE_CAD_HIGH`, `RULE_CAD_DBP_HIGH`) stay in the target set — the question is only the label-extraction strategy. Per §7c, options: (a) segment training by rollout phase so within-phase labels are consistent, (b) include effective-CAD-threshold as a feature snapshotted at label time, (c) both. Decide before training-data extraction. **Dropping CAD rules is not an option — they are Manisha-signed-off.**
- **Include patient-days that hit an evaluation gate as training examples?** §7c lists five gates that produce zero alerts regardless of vitals. Including them as clean negatives biases the model; excluding them shrinks the negative pool. Recommend including with a `gate_reason` feature so the model can distinguish "gated, not evaluated" from "evaluated and clean."
- **`RULE_ORTHOSTATIC_HYPOTENSION` predicted-target consistency.** Known defect: the "prior reading" has no lower time bound (`alert-engine.service.ts:1042`), so the rule fires today on an over-broad trigger. The rule remains a prediction target — the model learns the current firing pattern until Manisha signs off on a corrected trigger, then the model is retrained on the corrected labels. Do NOT hand-correct labels ourselves; the rule owner defines the trigger.
- **Two-tier `RULE_BRADY_SURVEILLANCE` handling** — same rule ID appears in `TIER_3_INFO` (< 3 day run) and `TIER_2_DISCREPANCY` (sustained ≥ 3 days). The model must predict both the rule AND the tier context, or the rule label alone is ambiguous. Both tier variants are Manisha-signed-off and must be predictable.
- ~~**`RULE_BRADY_HR_ASYMPTOMATIC` code-fix vs. prediction-target sequencing.**~~ **Closed 2026-07-17 — no longer an open question.** The rule was deleted rather than implemented (N-7, `128be52`, 2026-07-16); its clinical ground is fully covered by `RULE_BRADY_ABSOLUTE` (<40) and `RULE_BRADY_SURVEILLANCE` (40–49 asymptomatic). Nothing emits it, so there is no label to sequence and no ticket to open.

### 14a · Decisions & open questions from the review call

There is no migration — the rule engine is permanent (§0). These are the decisions and open items to settle before scoping the build.

- **Online/streaming learning vs. periodic batch retraining — RUN A SPIKE.** The open question raised on the call: *"whether it needs to be constantly trained or whether it can capture trends while it is running."* Time-series/anomaly models can sometimes update state as readings arrive rather than retraining on a cadence. This choice drives the whole serving + monitoring design (§10, §11). Decide via a spike before committing an architecture. **Owner: Niva.**
- **External training dataset — do the variables we need even exist in a purchasable/public set?** Conclusion from the call: patient pilot data alone will not be enough to train a forecasting model; we need a dataset that "captures ambiguity" (the analogy raised was stock-market-style trend analysis). Critical constraint: **the dataset must contain the variables we are defining** (§2, §3). Action: search for cardiac time-series datasets carrying BP/HR/weight/symptom/med signals over time; **run the shortlist by Manisha** for clinical validity. Without a viable dataset, the forecasting model is blocked regardless of pilot enrollment.
- **New capture fields go through Manisha BEFORE any schema change.** The doc now proposes exactly **one** set of new capture fields — the optional demographic / measurement-context fields (race/ethnicity, arm circumference, measurement hand, §3a) — plus anything that would increase capture cadence. All of it must be run by Manisha for clinical practicality and consent/HIPAA implications first. The call was unambiguous: *"those things we will have to run it by Manisha first — without it, it does not make sense."* Nothing gets added to the schema until she signs off. (Everything else earlier drafts proposed — outcome-label, confidence, what-changed, wearable tables — is cut, §3b.)
- **The learned personalization offset is the biggest clinical-safety question in the whole doc.** The mechanism — for a patient chronically high-but-asymptomatic, raise their surfacing threshold via a learned multiplier — is powerful but hazardous: a patient stable at a high BP is still at elevated stroke risk, and "no symptoms" is not "no risk." Non-negotiables before it ships: (a) applies to **non-emergency thresholds only** — the emergency floor never moves (the "stable at 200" example is *inside* the emergency range and therefore not a candidate); (b) the offset is **bounded and provider/Manisha-confirmable**, never silently applied; (c) it can tighten freely but may only loosen within a Manisha-approved cap. Frame this to Rengan and Manisha as decision-support tuning, not autonomous suppression.
- **Two-audience deliverable (committed on the call).** Produce an updated version of this doc for **two readers**: (1) **Rangan** — the patent-facing framing (rule engine permanent + ML personalization/prediction on top, prediction beneath a non-bypassable emergency floor); (2) **Manisha** — the clinical-practicality memo listing every new variable we'd want to capture, asking which are acceptable/collectable, and whether datasets carrying those variables exist. Ship both.
- **Population-cohort baseline (the "level above" flagged as future scope).** Beyond per-patient personalization, cluster demographically-similar patients (e.g. males ~40-50) and derive a **new** patient's starting baseline from the cohort — cold-start via similar existing patients (ties to §12). Guidance from the call: treat per-patient personalization as the **starting point**; cohort-clustering is an expansion, not v1.
- **Two-tier `RULE_BRADY_SURVEILLANCE` in the forecast/advisory.** The rule spans `TIER_3_INFO` (< 3-day run) and `TIER_2_DISCREPANCY` (sustained ≥ 3 days). The forecast/advisory must carry the run-length context so the surfaced tier matches the rule engine's; the rule engine still fires the actual alert. Do not model the two variants as separate targets.
- **Emergency-tier forecast that beats the rule engine → escalate to Manisha, never self-promote.** If the forecaster flags an emergency the deterministic thresholds would miss, the action is a **rule-threshold review with Manisha**, not giving the model authority. Emergency-tier forecasting exists to surface exactly this feedback for the rule owner.

---

## 15 · Next-step brainstorm outputs (what would come out of a follow-up session)

- **Two updated docs (per §14a):** the **Rangan/patent** version and the **Manisha/clinical-practicality** version.
- **Dataset-availability memo** — the shortlist of external cardiac time-series datasets that carry our variables, with a clinical-validity read from Manisha. Gates the whole forecasting build.
- **Online-vs-batch retraining spike result** — the decision + rationale for the learning regime (§4.0 open question).
- **Feature dictionary v1** — the exact ~80-100 features (raw + derived), with source citations, tolerances, and null-handling policy.
- **Schema-change proposal (Manisha-gated)** — the **only** new capture fields are the §3a demographic / measurement-context fields (race/ethnicity, arm circumference, measurement hand), presented to Manisha before any Prisma migration.
- **Personalization-offset design + bounds** — the learned per-patient offset mechanism, its caps, and the provider/Manisha confirmation flow (the clinical-safety item above).
- **Model-job bake-off plan** — time-series forecaster vs. anomaly detector vs. tabular classifier, tested against the external dataset once sourced.
- **Threshold-setting protocol (Manisha-gated)** — the §9e method executed for real: the shadow-mode achievable frontier per tier, the harm:benefit ratio elicited from Manisha (the DCA threshold probability — *"how many false alarms would you review to catch one true event?"*), the alert-fatigue budget from ops, and the resulting per-tier operating points — locked as PCCP acceptance criteria. **Until this runs, every target number in §9a is a placeholder.**
- **Regulatory pathway memo** — FDA De Novo vs. 510(k) vs. Software-as-a-Medical-Device Non-clearance path, with timeline.
- **⚠️ Citation audit before any external release.** This doc now cites external literature — concept-drift theory (Gama 2014; Bifet & Gavaldà 2007; Gama 2004), clinical-ML drift (Davis *JAMIA* 2017; Wong *JAMA IM* 2021; Finlayson *NEJM* 2021), Decision Curve Analysis (Vickers & Elkin 2006), feedback loops (Adam MLHC 2020), global time-series models (Salinas *DeepAR* 2020), and the FDA PCCP guidance (Dec 2024). **Every citation must be verified against the source paper before the Rangan/patent or Manisha versions ship.** They were written from recall; a mis-cited reference in a patent-facing document is worse than no reference. Verify author/venue/year and — more importantly — that each paper actually supports the claim attached to it.

---

## Appendix — Complete feature list, ready for review

**~90 candidate features, grouped, all already-storable except the three optional §3a demographic fields:**

*Per-reading (last N readings in window):* `systolicBP`, `diastolicBP`, `pulse`, `weight`, `position`, `medicationTaken`, `medicationScheduledLater`, `missedDoses` count, `missedMedications` per-drug detail (17 features), 17 symptom booleans, `measurementConditions` structured breakdown (~8 keys), `delayBand`, `narrowPpArtifact`, `singleReadingFinalized`, `measuredAt`, `createdAt−measuredAt` lag.

*Static (patient-level):* `gender`, `heightCm`, `dateOfBirth` (derived: age), `isPregnant`, `pregnancyDueDate`, `historyHDP`, `hasHeartFailure`, `heartFailureType`, `hasAFib`, `hasCAD`, `hasHCM`, `hasDCM`, `hasAorticStenosis`, `hasTachycardia`, `hasBradycardia`, `diagnosedHypertension`, `aceContraindicatedAt`, `profileVerificationStatus`, arm circumference (new), race/ethnicity (new, optional).

*Medication portfolio (active meds):* 15-class one-hot, `frequency` per drug, `verificationStatus`, `holdReason` presence, `holdEscalationLevel`, `daysOnMed`, `isCombination` count, `discontinuedAt`-in-window count.

*Threshold:* `sbpUpperTarget`, `sbpLowerTarget`, `dbpUpperTarget`, `dbpLowerTarget`, `hrUpperTarget`, `hrLowerTarget`, `AlertMode` (STANDARD/PERSONALIZED), threshold-age-days.

*Derived / rolling:* 7-day mean SBP/DBP/pulse, 14-day mean, 30-day mean, SBP/DBP standard deviation per window, BP slopes (3d/7d/14d), weight slope (24h/3d/7d/14d), weight-delta-from-baseline, adherence % (3d/7d/14d/30d), consecutive-miss run length, readings/week, days-since-last-reading, longest-gap-in-window, time-of-day distribution features, session-average-vs-max deltas, target-deviation features.

*Historical labels:* time-since-last-alert per tier (7 features), disposition history counts (per-disposition, last 60 days), prior escalated-alert count.

*New (the only additions, §3a):* `raceEthnicity`, `arm_circumference_cm`, `preferred_measurement_hand` — all optional, fairness/calibration only. (Earlier drafts' `outcomeType`, `changeContext`, `readingConfidenceScore` are **cut** — see §3b; labels come from existing disposition / `resolutionRationale` fields.)

---

**End of brainstorm.** Nothing here is committed. Every field cited exists in `backend/prisma/schema/*.prisma` today or is named as a new addition in §3. Every alert tier cited exists in `AlertTier` today. Every disposition cited exists in `RESOLUTION_CATALOG` today. The model architectures are the ones the patent doc's Q16 framed and this doc expands.

Ready for the next brainstorm pass whenever.
