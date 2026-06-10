# Cardioplace D4 Backlog #2 — Active Medication List Wording Sign-Off

**Title:** Active Medication List in Physician-Tier Messages — Clinical Wording Sign-Off
**Date:** 2026-06-09
**Prepared for:** Duwaragie Kugaraj (Dev 3), Ruhim (CTO)
**Reviewed by:** Dr. Manisha Singal (CMO)
**Re:** D4 Decision 4 backlog #2 — `medicationListPhrase` rendering in per-rule physician messages (issue #69)
**Status:** SIGNED OFF — proceed with implementation per decisions below

---

## Overview

Engineering has landed the plumbing for the `medicationListPhrase(ctx)` helper (issue #69). The patient's full active medication list (excluding the triggering drug already named in the message) is now available to every alert message. This sign-off covers which rules should render the suffix and confirms the proposed wording for each.

No engine changes, no escalation behavior changes, no schema changes — purely wording.

---

## Candidate A — `RULE_PREGNANCY_ACE_ARB`

**Decision:** APPROVED AS DRAFTED

**Proposed wording** (suffix inserted after drug identification, before clinical guidance):

> CONTRAINDICATION — Pregnant patient on ${cls}: ${names}${gestationalAgePhrase}.${medicationListPhrase} ACE/ARBs are contraindicated in pregnancy (FDA Category D/X). Recommend immediate substitution (CHAP-protocol alternative — labetalol or long-acting nifedipine). Patient has been advised not to self-discontinue.

**Clinical rationale:**

The substitution decision between labetalol and long-acting nifedipine — the two preferred agents per the 2025 AHA/ACC Hypertension Guideline (Class 1, Level A) — is directly influenced by the existing regimen. If the patient is already on a beta-blocker (e.g., atenolol, which itself should be switched given its Class III: Harm designation in pregnancy), the provider may lean toward nifedipine to avoid beta-blocker stacking. Conversely, if the patient is on a CCB, labetalol may be preferred.

The ADA Standards of Care 2026 lists methyldopa, labetalol, and long-acting nifedipine as the safe alternatives, with diuretics not recommended for BP management in pregnancy — so the provider needs to see the full picture to make the right swap. Surfacing the active medication list at the point of the contraindication alert saves the provider a chart lookup during a time-sensitive decision.

**Evidence basis:**
- 2025 AHA/ACC Hypertension Guideline (Jones et al., JACC 2025;86(18):1567-1678)
- JACC State-of-the-Art Review on cardiovascular medications in pregnancy (Halpern et al., JACC 2019;73(4):457-476)
- ADA Standards of Care 2026, Chapter 10: Cardiovascular Disease and Risk Management (Diabetes Care 2026;49(S1):S216-S245)

---

## Candidate B — `RULE_NDHP_HFREF`

**Decision:** APPROVED AS DRAFTED

**Proposed wording:**

> CONTRAINDICATION — HFrEF patient on non-dihydropyridine CCB: (${names}).${medicationListPhrase} NDHP-CCBs are potentially harmful in HFrEF (negative inotropy) per 2022 AHA/ACC/HFSA HF guideline. Recommend review and substitution.

**Clinical rationale:**

The substitution calculus for an HFrEF patient on a contraindicated NDHP-CCB (verapamil or diltiazem) depends entirely on the current GDMT status. The 2024 ACC Expert Consensus Decision Pathway identifies 4 key medication pillars for HFrEF: ARNI (or ACE-I/ARB), evidence-based beta-blocker (carvedilol, metoprolol succinate, or bisoprolol), MRA, and SGLT2 inhibitor.

If the NDHP-CCB was being used for rate control in atrial fibrillation, the provider needs to know whether the patient is already on a beta-blocker (which could assume the rate-control role) or whether a beta-blocker needs to be initiated simultaneously. The AHA Scientific Statement explicitly states that NDHP-CCBs should be avoided in HFrEF (Class III: Harm) and that amlodipine is the only CCB with neutral safety data in this population — but only for refractory hypertension after GDMT optimization. Seeing the full regimen tells the provider whether GDMT gaps exist that should be filled as part of the substitution.

**Evidence basis:**
- 2024 ACC Expert Consensus Decision Pathway for HFrEF (Maddox et al., JACC 2024)
- AHA Scientific Statement on comorbidities in chronic HF (Bozkurt et al., Circulation 2016)
- Review of NDHP-CCBs and beta-blockers in AF and HF (Triska et al., Cardiovasc Drugs Ther 2023)

---

## Candidate C — `RULE_ACE_ANGIOEDEMA`

**Decision:** REJECTED — defer medication list to a follow-up Tier 2 row

**Current wording (unchanged — no suffix added):**

> AIRWAY EMERGENCY — Suspected ACE-inhibitor angioedema. Patient on ${aceName} reports ${symptoms}. ACE-induced angioedema is bradykinin-mediated, NOT histamine-mediated. Epinephrine/antihistamines/corticosteroids are NOT reliable. Manage airway. Patient instructed to call 911. Permanent contraindication on resolution.

**Clinical rationale for rejection:**

ACE-inhibitor angioedema is a bradykinin-mediated airway emergency — the priority at the moment of alert is airway management, not medication reconciliation. The NEJM trial of icatibant in ACE-I angioedema (Baş et al., NEJM 2015) demonstrated that standard therapy (corticosteroids + antihistamines) is ineffective because the mechanism is not histamine-mediated, and the alert message already communicates this critical point. Adding a medication list to this message introduces cognitive noise at exactly the wrong moment — when the provider (or ED team) needs to focus on:

- Airway patency
- ACE-I discontinuation
- Consideration of bradykinin-targeted therapy (icatibant, FFP, C1-INH)

The medication list becomes relevant after the acute event resolves, when the provider needs to select a substitute antihypertensive. The AAAAI parameter update (Zuraw et al., JACI 2013) notes that ARBs have been associated with angioedema less commonly, but some patients will cross-react — so the substitution decision (ARB vs. alternative class) does benefit from seeing the full regimen. This is better served by a follow-up Tier 2 alert or a post-resolution provider note rather than cluttering the emergency message.

**Recommended follow-up:** Create a backlog ticket for a post-resolution Tier 2 provider note that includes the medication list for substitution planning. This separates the airway-emergency signal from the medication-reconciliation signal.

**Evidence basis:**
- Icatibant in ACE-I angioedema (Baş et al., NEJM 2015;372(5):418-425)
- Pharmacologic management of ACE-I angioedema (Scalese & Reinaker, Am J Health Syst Pharm 2016)
- AAAAI focused parameter update on ACE-I angioedema (Zuraw et al., JACI 2013)

---

## Candidate D — `RULE_NSAID_ANTIHTN_INTERACTION`

**Decision:** APPROVED AS DRAFTED

*Note: original sign-off referenced this rule as `RULE_NSAID_ANTIHYPERTENSIVE` — the actual registry key in code is `RULE_NSAID_ANTIHTN_INTERACTION`. Same rule, paraphrased name.*

**Proposed wording:**

> INTERACTION — Patient on antihypertensive (${cls}) reports NSAID use.${medicationListPhrase} NSAIDs can elevate BP and blunt antihypertensive effect. Recommend acetaminophen alternative if appropriate.

**Clinical rationale:**

The clinical value of the medication list here is substantial and well-supported by evidence. The "triple whammy" combination of NSAID + RAS inhibitor (ACE-I/ARB) + diuretic carries a significantly elevated AKI risk:

- BMJ nested case-control study (487,372 antihypertensive users): triple therapy associated with rate ratio of 1.31 (95% CI 1.12–1.53) for AKI, with highest risk in first 30 days (RR 1.82, 95% CI 1.35–2.46) (Lapi et al., BMJ 2013)
- Case-crossover study: triple combination carried adjusted OR of 29.22 (95% CI 12.82–66.64) for AKI hospitalization (Weng et al., Arch Gerontol Geriatr 2024)
- Community-based study: absolute AKI risk highest for NSAIDs in triple vs. dual combinations (NNH 158 for triple vs. >300 for dual) (Dreischulte et al., Kidney Int 2015)

The current alert message says "NSAIDs can elevate BP and blunt antihypertensive effect" — but the AKI risk from the triple whammy is arguably the more dangerous interaction, and the provider can only assess this risk if they can see whether the patient is on a diuretic and/or RAS inhibitor alongside the named antihypertensive class. The VA CKD guideline specifically notes that concomitant use of multiple agents that affect kidney hemodynamics (e.g., RAASi, diuretics, SGLT2i, finerenone) as well as volume depletion may further increase the risk of NSAID-induced AKI.

**Evidence basis:**
- Triple whammy AKI risk (Lapi et al., BMJ 2013;346:e8525)
- NSAID + RAS-I + diuretic AKI risk (Weng et al., Arch Gerontol Geriatr 2024)
- Community AKI risk with NSAIDs (Dreischulte et al., Kidney Int 2015)
- VA/DoD CKD Clinical Practice Guideline (2025)

---

## Rules NOT receiving the suffix — confirmed

The following rule categories are correctly excluded from the `medicationListPhrase` suffix:

- Patient-tier wording: the patient's other meds aren't useful to them at the point of contact
- Caregiver-tier wording: caregivers don't need raw drug-class detail
- BP/HR threshold rules (standard L1/L2, HFREF_HIGH, CAD_HIGH, etc.): the med list isn't clinically meaningful at the moment of a high BP — those rules are about the reading, not the regimen
- Pregnancy threshold rules (`RULE_PREGNANCY_L2`, `RULE_PREGNANCY_L1_HIGH`): same rationale — these are about the BP, not the medication regimen

No additional rules are recommended for the suffix at this time.

---

## Summary table

| Candidate | Rule | Decision | Key rationale |
|---|---|---|---|
| A | `RULE_PREGNANCY_ACE_ARB` | APPROVED | Substitution choice (labetalol vs. nifedipine) depends on existing regimen |
| B | `RULE_NDHP_HFREF` | APPROVED | GDMT gap assessment needed for substitution; rate-control implications |
| C | `RULE_ACE_ANGIOEDEMA` | REJECTED — defer to Tier 2 follow-up | Airway emergency; med list is cognitive noise at point of crisis |
| D | `RULE_NSAID_ANTIHTN_INTERACTION` | APPROVED | Triple whammy AKI risk requires full regimen visibility |

---

## Next steps

1. Patch the 3 approved rule messages in `shared/src/alert-messages.ts` (Candidates A, B, D)
2. Update message-registry snapshot tests
3. Create backlog ticket for Candidate C: post-resolution Tier 2 provider note with medication list for substitution planning
4. Ship as follow-on commit to the perennial branch
5. Close issue #69 (D4 #2)
