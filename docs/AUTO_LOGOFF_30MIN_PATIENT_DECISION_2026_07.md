# Auto-logoff — 30-minute patient default: decision note

**Date:** 2026-07-01 · **Owner:** Nivakaran · **For:** Duwaragie / Manisha
**Status:** verification + open decision. No code change proposed.

## TL;DR
The auto-logoff stack is **already shipped and verified**. Current thresholds are
**15 min (web) / 5 min (mobile)**, signed off by Manisha (2026-06-12, Doc 3 Q7). Duwaragie earlier
preferred **30 min for the patient app**. The code matches Manisha's values. **Recommendation:
keep 15/5 as-is**; only change the patient web value to 30 min if Manisha re-approves — it is a
one-line env/config change, not a rebuild.

## What is shipped (HIPAA §164.312(a)(2)(iii) — automatic logoff)

| Piece | Location | Behaviour |
|---|---|---|
| Idle hook (both apps) | `frontend/src/lib/hooks/useIdleTimeout.ts`, `admin/src/lib/hooks/useIdleTimeout.ts` | 15 min web / 5 min mobile; 60-s warning; resets on mouse/key/touch/scroll + tab refocus |
| Warning toast (both apps) | `frontend/src/components/auth/IdleWarningToast.tsx`, `admin/.../IdleWarningToast.tsx` | `role="alert"` "You will be signed out in ~60 s… / Stay signed in" |
| Client wiring | `frontend/src/lib/auth-context.tsx`, `admin/src/lib/auth-context.tsx` | `onWarn` → toast; `onTimeout` → `POST /logout` + clear state + `→ /sign-in?session_expired=1` |
| Backend enforcement | `backend/src/auth/auth.service.ts` `rotateRefreshToken` (~L412-453) | If `AuthSession.lastActivityAt` is older than the per-device threshold, `/refresh` → 401 + chain revoked + `idle_timeout` AuthLog event |
| Session state | `AuthSession.lastActivityAt` (`@updatedAt`), `AuthSession.deviceType` (`web`/`mobile`) | server-side clock; can't be spoofed by the client |

**Belt + suspenders:** the client hook logs the user out visually, and even if the client is bypassed,
the server refuses to rotate an idle refresh token — so a stolen/kept tab cannot silently stay alive.

## Verification (no build required)
- **Backend matrix:** `qa/tests/32-idle-timeout.spec.ts` — web 14 min ✅ pass / 16 min ❌ 401, mobile
  4 min ✅ / 6 min ❌, admin 20 min ❌, and the activity-heartbeat reset. Drives the gate via
  `test-control auth-session/backdate` (no real sleeping).
- **Boundary spec (this sprint):** `qa/tests/4Y-auto-logoff.spec.ts` — asserts the exact web
  15-min boundary (14 min → 201, 16 min → 401) as the auto-logoff verification deliverable.

## The open decision — 30-min patient web timeout?
- **Manisha (2026-06-12, signed):** 15 min web / 5 min mobile, applied uniformly (patient + admin).
- **Duwaragie (earlier preference):** 30 min for the **patient** app specifically (patients check BP at
  home on personal devices; a 15-min timeout mid-check-in is friction).
- **Current code:** matches Manisha (15/5). No divergence.

**Recommendation:** keep 15/5. If we want 30 min for patient web, it is a scoped change:
a per-role/per-app threshold in `useIdleTimeout` (client) **and** the `rotateRefreshToken` gate
(server) must move together, and it needs **Manisha's explicit re-approval** since she signed the
current value. Until then, no change. Raise at the next Manisha sync.

_Deliverable location note: the sprint named `Documents/cardioplace-handoffs/` (outside the repo);
kept in-repo `docs/` so it lives with the code and CI._
