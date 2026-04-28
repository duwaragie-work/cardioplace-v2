# Postman — Alert Engine Collection

Drop-in Postman collection that mirrors [docs/POSTMAN_ALERT_TESTING.md](../POSTMAN_ALERT_TESTING.md) AND the alert-related test cases pulled from [docs/E2E_TEST_CASES.md](../E2E_TEST_CASES.md) (§11, §12, §13, §15) and [docs/TESTING_FLOW_GUIDE.md](../TESTING_FLOW_GUIDE.md).

**95 pre-built requests across 10 folders** covering every alert rule scenario, alert resolution flows, patient-side reads, and RBAC negative tests.

## Files

| File | Purpose |
|---|---|
| `cardioplace-alerts.postman_collection.json` | The collection — 54 requests in 12 folders |
| `cardioplace-dev.postman_environment.json` | Environment variables (baseUrl, tokens, etc.) |

## Import

1. Open Postman → **File → Import** → drop both JSON files in.
2. In the top-right env selector, switch to **`cardioplace-dev`**.
3. Confirm `baseUrl` is `http://localhost:4000` (default) — adjust if your backend runs elsewhere.

## First-time workflow

```
1. Backend running? cd backend && npm run start:dev
2. Run "1. Setup — Authentication" folder in order:
     • Send OTP — patient
     • Verify OTP — patient    ← auto-saves {{accessToken}} + {{patientUserId}}
3. Pick a scenario from "3. Category A" or "4. Category B"
4. Click Send → check the test results pane (assertions + console.log of expected ruleId)
5. Run "2. Helpers → List my alerts" to see what fired
```

## Folder map

| Folder | What it tests | Login as |
|---|---|---|
| **1. Setup** | OTP login (patient + MD) | — |
| **2. Helpers** | Read-only verification endpoints | patient or MD |
| **3.A1 Tier 1 contraindications** | Pregnancy+ACE, HFrEF+NDHP, Tier 1 beats BP L2 | priya / james / priya |
| **3.A2 BP L2 emergency** | Absolute emergency 190/105 | aisha |
| **3.A3 Symptom overrides** | 6 typed symptom flags + 1 pregnancy-specific (RUQ) | aisha (or pregnant clean patient) |
| **3.A4 BP L1 High** | Pregnancy L1, AFib HR (×3), Wide-PP annotation, Suboptimal retake, Boundary | varies |
| **3.A5 BP L1 Low** | CAD-DBP-critical, Age 65+, Standard low, Brady asymptomatic | rita / custom / aisha / custom |
| **3.A7 Tier 3** | Wide PP standalone, Loop diuretic | aisha / custom |
| **3.A8 Tier 2 medication** | NEW — medication missed (4 sub-cases incl. two-row co-occurrence) | aisha |
| **3.A9 No-alert** | Resolve-sweep, AFib gate, BB suppression | varies |
| **4. Category B** | Set threshold, Personalized HIGH/LOW, pre-Day-3, no-threshold edge | MD + custom patient |
| **5. Boundary** | Strict `<` vs `≤` cutoffs | aisha / rita |
| **6. Auth/gate errors** | 403 no-intake, 401 no-JWT, 403 wrong-role, 400 validation | varies |
| **7. Alert resolution** *(new)* | TC-RES.01–50: ack, resolve Tier 1 / Tier 2 / BP L2 + audit + retry | provider / MD |
| **8. Patient escalations + notifications** *(new)* | TC-RDG.09–15: GET escalations, GET / PATCH notifications | patient |
| **9. RBAC alert endpoints** *(new)* | TC-RBAC.17/18/24/44: PATIENT 403, PROVIDER 200, OPS 200 | varies |
| **10. Escalation ladder (notes only)** *(new)* | §13 — pointer to Jest escalation.e2e-spec; HTTP can't time-travel runScan | — |

## Folder 7 — Alert resolution workflow

The new `7. Alert resolution` folder has a specific dependency chain:

```
1. Setup → log in as patient
2. Run a Category A scenario (e.g. Scenario 4 — 190/105) to create an alert
3. 7 → "Save first OPEN alertId" (auto-saves {{alertId}})
4. 7 → "Send OTP — Provider" + "Verify OTP — Provider" (auto-saves {{providerAccessToken}})
5. 7 → Run TC-RES.01 (acknowledge), TC-RES.10 (resolve Tier 1), or any other resolution test
6. 7 → "TC-RES.50 — Get audit" to inspect the 15-field audit row
```

Each TC-RES request has a Test script that asserts the expected status / response shape. The console output points to the matching expected behavior in `E2E_TEST_CASES.md §12`.

## Folder 10 — Escalation ladder (limitation)

§13 escalation tests (TC-ESC.*) require **time-travel via `EscalationService.runScan(now)`** — a Nest service method, not an HTTP endpoint. **Postman cannot drive these directly.**

Workarounds:
- For deterministic time-based tests, run `cd backend && npx jest escalation.e2e-spec` (Jest can mock dates).
- For wall-clock tests, trigger an alert and wait 15 minutes for the `@Cron('*/15 * * * *')` scanner to fire, then `GET /api/daily-journal/escalations` to inspect.

The folder contains a single pointer request (`GET /escalations`) for visibility.

## How auto-save works

The collection's **Verify OTP** requests have a Test script that automatically writes the JWT into the environment:

```js
const r = pm.response.json();
if (r.accessToken) pm.environment.set('accessToken', r.accessToken);
if (r.userId) pm.environment.set('patientUserId', r.userId);
```

Same pattern for `mdAccessToken` (the MD login). After running these once, every other request picks up the token automatically via Bearer auth.

The collection-level pre-request script also resets `{{measuredAt}}` to *now* before every request, so payloads always pass the 30-day-window validator without manual edits.

## Tips

- **`{{entryId}}`** is auto-saved by every scenario's Test script. Use the **2. Helpers → Get latest alert by entryId** request to fetch only the alert(s) tied to your last submission.
- **Running B2 / B3 (Personalized rules)?** You need ≥7 prior journal entries on the same patient. Click **B-Prep. Log a benign reading** in folder 4 seven times before B2 / B3.
- **Running scenarios that need a clean patient (e.g., pregnancy without ACE/ARB)?** Sign up your own patient via OTP, complete `POST /api/intake/profile` + `POST /api/intake/medications`, then re-run the scenario. The seed patients (priya, james, etc.) come pre-loaded with specific drug profiles that may trigger Tier 1 short-circuits.
- **Don't share a database between testers.** Per [TESTING_FLOW_GUIDE.md §15.3](../TESTING_FLOW_GUIDE.md), each tester gets their own Postgres so prior-reading counts and alert-resolution timelines don't collide.

## Where to file bugs

If a scenario doesn't match expected output, paste into your Google Doc tab:

| Field | Value |
|---|---|
| Scenario # | e.g. Scenario 12 |
| Patient login | e.g. priya.menon |
| Pre-conditions | e.g. threshold(130/90) + 7 readings |
| Payload sent | (raw JSON) |
| Expected ruleId | e.g. RULE_PERSONALIZED_HIGH |
| Actual response body | (paste the alert row) |
| Timestamp | ISO |

Cross-reference the expected behavior in:
- [docs/POSTMAN_ALERT_TESTING.md](../POSTMAN_ALERT_TESTING.md) — narrative version with full expected outcomes
- [docs/ALERT_SCENARIOS.md](../ALERT_SCENARIOS.md) — Jest unit-test version of every scenario
