# Provider Training: Handling a Typo on an Emergency Alert

**Audience:** Pilot providers, backup providers, medical director
**Source:** Dr. Manisha Singal sign-off, 2026-06-12 — *Edit-Window + Session Policy*, Q2 "Typo-on-emergency workflow"
**Status:** Pilot-readiness checklist item (Implementation Note 4)

---

## The situation

A patient enters a blood-pressure reading, an emergency alert fires (e.g.
BP Level 2 at 195/120), and then it turns out the patient **fat-fingered the
number** — they meant 135/85, not 195/120. The patient may correct the reading
themselves within the 5-minute edit window, or the corrected value may surface
later.

**The alert has already fired. We cannot un-page.** Once an emergency alert is
dispatched, the system intentionally does **not** auto-resolve it when the
underlying reading is edited or deleted. A page that went to a provider must be
closed by a human with a documented reason — never silently retracted.

> Why we don't auto-close: a "typo" correction can itself be wrong (a patient
> talked out of going to the ED, or downplaying symptoms). Clinical judgment,
> not a string edit, closes an emergency.

## What the system does for you

- The alert **stays OPEN** on your dashboard and continues to escalate on its
  ladder until you resolve it.
- Every patient edit and delete is captured in the **audit log** — the original
  195/120, the corrected 135/85, and the timestamps of both are preserved. The
  reading history is never destructively overwritten.

## What you do

1. **Open the patient.** Go to the **Timeline** tab and the **Readings** tab.
2. **Read the trail.** The Timeline shows the alert firing and any subsequent
   patient edits; the Readings tab shows the current (patient-edited) value
   next to what originally triggered the alert. Confirm with your own eyes that
   the corrected value is plausible and consistent (position, pulse, recent
   trend).
3. **Verify the patient is actually OK.** A corrected number is not the same as
   a well patient. If there's any doubt, make the outreach call — that is what
   the alert was for.
4. **Resolve with a documented rationale.** Close the alert from the dashboard
   and pick the resolution action that matches what you did. The rationale
   free-text is **required** for every emergency (BP Level 2) resolution — state
   that the trigger was a data-entry error and how you confirmed the patient's
   current status (e.g. "Patient corrected entry to 135/85 within edit window;
   phoned patient, asymptomatic, no chest pain/SOB/headache — typo confirmed").

The rationale you write becomes part of the permanent Joint-Commission audit
trail for that alert. Write it as if it will be read in a chart review, because
it will.

## Do NOT

- Do **not** assume an edited reading means a false alarm and walk away — the
  alert stays your responsibility until you resolve it.
- Do **not** delete the patient's original reading to "clean up" — the audit
  trail must retain both values. Deletion does not close the alert anyway.

---

*Related: this is distinct from the new Option D retake-to-confirm flow, which
prevents most BP-only typos from ever paging a provider by asking the patient
to confirm an emergency-range reading before it is submitted. This one-pager
covers the residual case — an emergency that fired (because symptoms were also
reported, or a confirmatory reading also read high) and later proves to be a
typo. See `docs/clinical-signoffs/MANISHA_2026_06_12_EDIT_WINDOW_AND_SESSION_POLICY_SIGNOFF.md`.*
