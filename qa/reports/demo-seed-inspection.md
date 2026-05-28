# Prod demo-seed inspection — 2026-05-28T10:31:46Z

Connection: `db.prisma.io:5432/postgres` (Prisma Postgres, role `prisma_migration`, PostgreSQL 17.2). All queries SELECT-only.
Branch: `demo/dcha-seed-refresh` off main @ `c2a44ce`.

## Q1 — Seed-managed test users
```
             id             |         email         |        name        |                  roles                  | accountStatus | enrollmentStatus | enrolledAt |        createdAt        
----------------------------+-----------------------+--------------------+-----------------------------------------+---------------+------------------+------------+-------------------------
 01KQDC8QKBHDV9CV3FBZD92J2N | support@healplace.com | Dr. Manisha Singal | {SUPER_ADMIN,PROVIDER,MEDICAL_DIRECTOR} | ACTIVE        | NOT_ENROLLED     |            | 2026-04-29 19:43:15.565

```

## Q2 — PatientProfile rows on those users
```
ERROR:  column p.hasHF does not exist
LINE 1: SELECT u.email, p."hasHF", p."hfType", p."hasCAD", p."hasHCM...
                        ^
HINT:  Perhaps you meant to reference the column "p.hasHCM".
```

## Q3 — Reading freshness (find the '1721 days' culprit)
```
 email | readings | last_reading | days_since 
-------+----------+--------------+------------

```

## Q4 — Open alerts on seed-managed accounts
```
 email | ruleId | tier | status | createdAt 
-------+--------+------+--------+-----------

```

## Q5 — Stale 'X days since' notifications
```
ERROR:  column n.createdAt does not exist
LINE 1: ...T u.email, n.title, LEFT(n.body, 100) AS preview, n."created...
                                                             ^
HINT:  Perhaps you meant to reference the column "u.createdAt".
```

## Q6 — Practices
```
       id        |             name             |        createdAt        
-----------------+------------------------------+-------------------------
 seed-cedar-hill | Cedar Hill Internal Medicine | 2026-04-29 19:43:19.388

```

## Q7 — Chat / Conversation rows (adjusted: schema is single `Conversation` table, no userId FK)
```
 total_conversations |          first          |          last           
---------------------+-------------------------+-------------------------
                   6 | 2026-04-30 07:42:23.109 | 2026-05-26 15:12:07.483

```

## Q8 — Non-seed users (real account drift) — STOP IF > 0
```
             id             |             email             |        name        |        createdAt        
----------------------------+-------------------------------+--------------------+-------------------------
 01KQDC8S5JM4DD9EPJZM4QCP8W | duwaragie22@gmail.com         | Dr. Samuel Okonkwo | 2026-04-29 19:43:17.171
 01KQDC8SNAJ9JPK0FBYBYS115E | duwaragiek.racsliit@gmail.com | Dr. Elena Reyes    | 2026-04-29 19:43:17.674
 01KQDC8T8C0KYH3XCNVQC2WRSK | it23270442@my.sliit.lk        | Dr. Priya Raman    | 2026-04-29 19:43:18.285
 01KQDC8TMWE5J8HR9A4XC0G75C | smartcampus.team@gmail.com    | Maria Rodriguez    | 2026-04-29 19:43:18.684
 01KQDC8W1RRPSTE5HQRP9XQNNJ | duwaragie@healplace.com       | Rebecca Carter     | 2026-04-29 19:43:20.12
 01KQDC94MVCC5J22TMB8MQ4X8W | james.okafor@gmail.com        | James Okafor       | 2026-04-29 19:43:28.923
 01KQDC9D1Z6HT0WFBQH2HDR0J8 | rita.washington@gmail.com     | Rita Washington    | 2026-04-29 19:43:37.535
 01KQDC9KGSFAEDA2GXHXM9YG5Q | charles.brown@gmail.com       | Charles Brown      | 2026-04-29 19:43:44.153
 01KQDC9V4XBQY80CGVZ3NH3P7S | aisha.johnson@gmail.com       | Aisha Johnson      | 2026-04-29 19:43:51.965
 01KQDKPBD3W2MZ4BBDVE88DSQ6 | weneram962@ryzid.com          | Alan               | 2026-04-29 21:53:01.859
 01KQECVB8T2QJY9QQXYZNDF2NV | lakshitha@reservato.ai        | Lakshitha          | 2026-04-30 05:12:39.962
 01KQEFV4P97RZTY4DT8XENT86R | lakshithaf20@gmail.com        |                    | 2026-04-30 06:04:58.954
 01KQF6NZM041WGRQGV8GXED0FZ | valanow774@justnapa.com       | Rebecca Carter     | 2026-04-30 12:44:07.168
 01KQF78670PX7DR8BYTCYYFR2Q | fivata6864@inreur.com         | Rebecca Carter     | 2026-04-30 12:54:03.744
 01KQFFJQQT3AX7K01M5414R7R2 | risindu@reservato.ai          | Rebecca            | 2026-04-30 15:19:37.978
 01KQPBJ38PZAKAEEAMZJBV8W8Y | toyofe9075@gixpos.com         |                    | 2026-05-03 07:24:03.734
 01KQPHS2ZMJ7J2XVEPX4Y3SC9E | lakshithaf096@gmail.com       |                    | 2026-05-03 09:12:44.276
 01KQSG0RYMF41ENEY6R45ETN8P | buddhikadevelopment@gmail.com |                    | 2026-05-04 12:39:42.292
 01KR35GD7XTYXJ0HMYV442HS5A | lakshithaf200@gmail.com       | Lakshitha          | 2026-05-08 06:48:24.573

```

---
## Q2-rerun — PatientProfile (correct column names from local schema)
```
           email           |     dateOfBirth     | hasHeartFailure | heartFailureType | hasCAD | hasHCM | hasDCM | hasAFib | isPregnant | gender 
---------------------------+---------------------+-----------------+------------------+--------+--------+--------+---------+------------+--------
 duwaragie@healplace.com   | 1985-03-12 00:00:00 | t               | HFREF            | f      | f      | f      | f       | t          | FEMALE
 james.okafor@gmail.com    | 1963-04-22 00:00:00 | t               | HFREF            | f      | f      | f      | f       | f          | MALE
 rita.washington@gmail.com | 1967-11-02 00:00:00 | f               | NOT_APPLICABLE   | t      | f      | f      | f       | f          | FEMALE
 charles.brown@gmail.com   | 1955-02-18 00:00:00 | f               | NOT_APPLICABLE   | f      | f      | f      | t       | f          | MALE
 aisha.johnson@gmail.com   | 1958-08-22 00:00:00 | f               | NOT_APPLICABLE   | f      | f      | f      | f       | f          | FEMALE
 weneram962@ryzid.com      | 1985-02-22 00:00:00 | t               | HFREF            | t      | f      | f      | f       | t          | FEMALE
 lakshitha@reservato.ai    | 2008-04-17 00:00:00 | f               | NOT_APPLICABLE   | f      | f      | f      | f       | f          | MALE
 fivata6864@inreur.com     | 1985-03-12 00:00:00 | t               | HFREF            | f      | f      | f      | f       | t          | FEMALE

```

## Q3-rerun — Reading freshness ALL users (find '1721 days' culprit regardless of email pattern)
```
           email           |      name       | readings |      last_reading       | days_since 
---------------------------+-----------------+----------+-------------------------+------------
 rita.washington@gmail.com | Rita Washington |       10 | 2026-04-30 12:17:06.618 |         28
 charles.brown@gmail.com   | Charles Brown   |       10 | 2026-04-30 12:17:13.532 |         28
 aisha.johnson@gmail.com   | Aisha Johnson   |       10 | 2026-04-30 12:17:17.172 |         28
 james.okafor@gmail.com    | James Okafor    |       10 | 2026-04-30 12:16:59.346 |         28
 duwaragie@healplace.com   | Rebecca Carter  |       21 | 2026-04-30 12:36:11.462 |         28
 lakshitha@reservato.ai    | Lakshitha       |        1 | 2026-04-30 06:57:02.502 |         28

```

## Q4-rerun — Open alerts on ALL users
```
           email           |      name       |            ruleId             |            tier             | status |        createdAt        
---------------------------+-----------------+-------------------------------+-----------------------------+--------+-------------------------
 duwaragie@healplace.com   | Rebecca Carter  | RULE_PREGNANCY_L2             | BP_LEVEL_2                  | OPEN   | 2026-04-30 12:31:41.1
 duwaragie@healplace.com   | Rebecca Carter  | RULE_PREGNANCY_L1_HIGH        | BP_LEVEL_1_HIGH             | OPEN   | 2026-04-30 12:30:44.196
 rita.washington@gmail.com | Rita Washington | RULE_CAD_DBP_LOW              | BP_LEVEL_1_LOW              | OPEN   | 2026-04-30 12:17:03.034
 james.okafor@gmail.com    | James Okafor    | RULE_NDHP_HFREF               | TIER_1_CONTRAINDICATION     | OPEN   | 2026-04-30 12:16:55.258
 lakshitha@reservato.ai    | Lakshitha       | RULE_SYMPTOM_OVERRIDE_GENERAL | BP_LEVEL_2_SYMPTOM_OVERRIDE | OPEN   | 2026-04-30 06:57:06.096

```

## Q5-rerun — Stale 'days since' notifications on ALL users (col is `sentAt`, not `createdAt`)
```
           email           |      name       |         title          |                               preview                               |         sentAt          
---------------------------+-----------------+------------------------+---------------------------------------------------------------------+-------------------------
 duwaragie@healplace.com   | Rebecca Carter  | Time for your BP check | It's been 26 day(s) since your last reading. Please log today's BP. | 2026-05-26 13:00:10.257
 duwaragie@healplace.com   | Rebecca Carter  | Time for your BP check | It's been 26 day(s) since your last reading. Please log today's BP. | 2026-05-26 13:00:10.186
 james.okafor@gmail.com    | James Okafor    | Time for your BP check | It's been 26 day(s) since your last reading. Please log today's BP. | 2026-05-26 13:00:07.541
 james.okafor@gmail.com    | James Okafor    | Time for your BP check | It's been 26 day(s) since your last reading. Please log today's BP. | 2026-05-26 13:00:07.47
 aisha.johnson@gmail.com   | Aisha Johnson   | Time for your BP check | It's been 26 day(s) since your last reading. Please log today's BP. | 2026-05-26 13:00:06.297
 aisha.johnson@gmail.com   | Aisha Johnson   | Time for your BP check | It's been 26 day(s) since your last reading. Please log today's BP. | 2026-05-26 13:00:06.225
 charles.brown@gmail.com   | Charles Brown   | Time for your BP check | It's been 26 day(s) since your last reading. Please log today's BP. | 2026-05-26 13:00:02.236
 charles.brown@gmail.com   | Charles Brown   | Time for your BP check | It's been 26 day(s) since your last reading. Please log today's BP. | 2026-05-26 13:00:02.163
 rita.washington@gmail.com | Rita Washington | Time for your BP check | It's been 26 day(s) since your last reading. Please log today's BP. | 2026-05-26 13:00:00.893
 rita.washington@gmail.com | Rita Washington | Time for your BP check | It's been 26 day(s) since your last reading. Please log today's BP. | 2026-05-26 13:00:00.819
 james.okafor@gmail.com    | James Okafor    | Time for your BP check | It's been 24 day(s) since your last reading. Please log today's BP. | 2026-05-24 13:00:03.038
 james.okafor@gmail.com    | James Okafor    | Time for your BP check | It's been 24 day(s) since your last reading. Please log today's BP. | 2026-05-24 13:00:02.965
 aisha.johnson@gmail.com   | Aisha Johnson   | Time for your BP check | It's been 24 day(s) since your last reading. Please log today's BP. | 2026-05-24 13:00:02.04
 aisha.johnson@gmail.com   | Aisha Johnson   | Time for your BP check | It's been 24 day(s) since your last reading. Please log today's BP. | 2026-05-24 13:00:01.969
 charles.brown@gmail.com   | Charles Brown   | Time for your BP check | It's been 24 day(s) since your last reading. Please log today's BP. | 2026-05-24 13:00:01.675
 charles.brown@gmail.com   | Charles Brown   | Time for your BP check | It's been 24 day(s) since your last reading. Please log today's BP. | 2026-05-24 13:00:01.605
 rita.washington@gmail.com | Rita Washington | Time for your BP check | It's been 24 day(s) since your last reading. Please log today's BP. | 2026-05-24 13:00:01.017
 rita.washington@gmail.com | Rita Washington | Time for your BP check | It's been 24 day(s) since your last reading. Please log today's BP. | 2026-05-24 13:00:00.945
 duwaragie@healplace.com   | Rebecca Carter  | Time for your BP check | It's been 23 day(s) since your last reading. Please log today's BP. | 2026-05-23 13:00:01.189
 duwaragie@healplace.com   | Rebecca Carter  | Time for your BP check | It's been 23 day(s) since your last reading. Please log today's BP. | 2026-05-23 13:00:01.116
 james.okafor@gmail.com    | James Okafor    | Time for your BP check | It's been 22 day(s) since your last reading. Please log today's BP. | 2026-05-22 13:00:04.002
 james.okafor@gmail.com    | James Okafor    | Time for your BP check | It's been 22 day(s) since your last reading. Please log today's BP. | 2026-05-22 13:00:03.932
 aisha.johnson@gmail.com   | Aisha Johnson   | Time for your BP check | It's been 22 day(s) since your last reading. Please log today's BP. | 2026-05-22 13:00:02.828
 aisha.johnson@gmail.com   | Aisha Johnson   | Time for your BP check | It's been 22 day(s) since your last reading. Please log today's BP. | 2026-05-22 13:00:02.758
 charles.brown@gmail.com   | Charles Brown   | Time for your BP check | It's been 22 day(s) since your last reading. Please log today's BP. | 2026-05-22 13:00:01.892
 charles.brown@gmail.com   | Charles Brown   | Time for your BP check | It's been 22 day(s) since your last reading. Please log today's BP. | 2026-05-22 13:00:01.821
 rita.washington@gmail.com | Rita Washington | Time for your BP check | It's been 22 day(s) since your last reading. Please log today's BP. | 2026-05-22 13:00:00.755
 rita.washington@gmail.com | Rita Washington | Time for your BP check | It's been 22 day(s) since your last reading. Please log today's BP. | 2026-05-22 13:00:00.686
 duwaragie@healplace.com   | Rebecca Carter  | Time for your BP check | It's been 21 day(s) since your last reading. Please log today's BP. | 2026-05-21 13:00:01.067
 duwaragie@healplace.com   | Rebecca Carter  | Time for your BP check | It's been 21 day(s) since your last reading. Please log today's BP. | 2026-05-21 13:00:00.995

```

## Roles audit — who has what role on prod
```
             email             |        name        |                  roles                  | accountStatus | enrollmentStatus 
-------------------------------+--------------------+-----------------------------------------+---------------+------------------
 support@healplace.com         | Dr. Manisha Singal | {SUPER_ADMIN,PROVIDER,MEDICAL_DIRECTOR} | ACTIVE        | NOT_ENROLLED
 duwaragie22@gmail.com         | Dr. Samuel Okonkwo | {PROVIDER}                              | ACTIVE        | NOT_ENROLLED
 duwaragiek.racsliit@gmail.com | Dr. Elena Reyes    | {PROVIDER}                              | ACTIVE        | NOT_ENROLLED
 it23270442@my.sliit.lk        | Dr. Priya Raman    | {MEDICAL_DIRECTOR}                      | ACTIVE        | NOT_ENROLLED
 smartcampus.team@gmail.com    | Maria Rodriguez    | {HEALPLACE_OPS}                         | ACTIVE        | NOT_ENROLLED
 duwaragie@healplace.com       | Rebecca Carter     | {PATIENT}                               | ACTIVE        | ENROLLED
 james.okafor@gmail.com        | James Okafor       | {PATIENT}                               | ACTIVE        | ENROLLED
 rita.washington@gmail.com     | Rita Washington    | {PATIENT}                               | ACTIVE        | ENROLLED
 charles.brown@gmail.com       | Charles Brown      | {PATIENT}                               | ACTIVE        | ENROLLED
 aisha.johnson@gmail.com       | Aisha Johnson      | {PATIENT}                               | ACTIVE        | ENROLLED
 weneram962@ryzid.com          | Alan               | {PATIENT}                               | ACTIVE        | NOT_ENROLLED
 lakshitha@reservato.ai        | Lakshitha          | {PATIENT}                               | ACTIVE        | NOT_ENROLLED
 lakshithaf20@gmail.com        |                    | {PATIENT}                               | ACTIVE        | NOT_ENROLLED
 valanow774@justnapa.com       | Rebecca Carter     | {PATIENT}                               | ACTIVE        | NOT_ENROLLED
 fivata6864@inreur.com         | Rebecca Carter     | {PATIENT}                               | ACTIVE        | NOT_ENROLLED
 risindu@reservato.ai          | Rebecca            | {PATIENT}                               | ACTIVE        | NOT_ENROLLED
 toyofe9075@gixpos.com         |                    | {PATIENT}                               | ACTIVE        | NOT_ENROLLED
 lakshithaf096@gmail.com       |                    | {PATIENT}                               | ACTIVE        | NOT_ENROLLED
 buddhikadevelopment@gmail.com |                    | {PATIENT}                               | ACTIVE        | NOT_ENROLLED
 lakshithaf200@gmail.com       | Lakshitha          | {PATIENT}                               | ACTIVE        | NOT_ENROLLED

```

---
## Summary of findings — read before Phase 2

### Schema drift between spec and current main
The spec's Phase-1 SQL used column names that don't exist on the current schema. I re-ran with the actual names:
| Spec wrote | Actual column on `main` |
|---|---|
| `PatientProfile.hasHF` | `PatientProfile.hasHeartFailure` (+ `heartFailureType` enum) |
| `PatientProfile.hfType` | `PatientProfile.heartFailureType` |
| `PatientProfile.dateOfBirth` | `User.dateOfBirth` (lives on User, not Profile) |
| `Notification.createdAt` | `Notification.sentAt` |
| `ChatSession`/`ChatMessage` | single `Conversation` (sessionId is a string, no FK to User) |

This was pure spec-doc drift, not a prod issue — I'll use the correct names in `patients.ts`.

### What prod actually looks like vs. what the spec assumed
The spec assumed seed-managed users sit under `*@cardioplace.test`. **Prod doesn't match that pattern.** Only `support@healplace.com` matched. But the *names* in the prod User table line up with what `backend/prisma/seed/patients.ts` defines today — they've just been re-pointed to real Gmail/etc. addresses (manually or by an older seed run):

Seed-managed in prod (real emails, not `@cardioplace.test`):
- Admins/providers: `duwaragie22@gmail.com` (Okonkwo), `duwaragiek.racsliit@gmail.com` (Reyes), `it23270442@my.sliit.lk` (Raman), `smartcampus.team@gmail.com` (Maria Rodriguez, ops), `support@healplace.com` (Singal).
- Patients (only 5 of the 13 in `patients.ts` made it): `duwaragie@healplace.com` (Rebecca Carter), `james.okafor@gmail.com`, `rita.washington@gmail.com`, `charles.brown@gmail.com`, `aisha.johnson@gmail.com`.

Real drift (11 dev/QA test signups that **must not be deleted by the cleanup**):
`weneram962@ryzid.com`, `lakshitha@reservato.ai`, `lakshithaf20@gmail.com`, `valanow774@justnapa.com` (named "Rebecca Carter"), `fivata6864@inreur.com` (also "Rebecca Carter"), `risindu@reservato.ai`, `toyofe9075@gixpos.com`, `lakshithaf096@gmail.com`, `buddhikadevelopment@gmail.com`, `lakshithaf200@gmail.com`, `Alan` (`weneram962@ryzid.com`).

### "1721 days since" — not literally in prod right now
The notification cron is firing nightly. Current max `days_since` is **28** (last readings 2026-04-30, seeded ~28 days ago). The exact "1721" figure isn't on any current prod row — it was either briefing hyperbole or a different DB. Either way, the fix is the same: fresh `JournalEntry` rows from the new seed will reset the day count.

### Open alerts on prod right now (will need to be wiped or kept depending on cleanup decision)
- Rebecca Carter (`duwaragie@healplace.com`): `RULE_PREGNANCY_L1_HIGH`, `RULE_PREGNANCY_L2` — both OPEN
- James Okafor: `RULE_NDHP_HFREF` — OPEN
- Rita Washington: `RULE_CAD_DBP_LOW` — OPEN
- Lakshitha (`lakshitha@reservato.ai`, real drift): `RULE_SYMPTOM_OVERRIDE_GENERAL` — OPEN

### Recommendation — pivoting from spec's plan
The spec's `preflight_cleanup.sql` was written to delete by `email LIKE '%@cardioplace.test'`. **That pattern matches zero rows on prod.** A safe cleanup needs to be by **exact email list of the 5 prod-seed patients above** (Rebecca, James, Rita, Charles, Aisha), explicitly preserving the 11 drift accounts.

The hard "don't" list forbids any DELETE broader than exact emails/userIds, and explicitly forbids `LIKE '%@%'`. So we have two real options to choose from — pick before I write the cleanup SQL or seed code:

1. **Rebrand: keep prod's existing real emails as the seed canonical set.** Replace `patients.ts` so its 7 new DCHA personas reuse the existing prod emails where the persona names line up (`duwaragie@healplace.com` becomes Marcus Williams, etc.), and use new real emails (from your forthcoming list) for the 2 net-new personas. Cleanup deletes only the data attached to those 5+5 emails (JournalEntry, DeviationAlert, Notification, EscalationEvent, Conversation by session lookup). Drift accounts untouched.
2. **Hard reset: keep the spec's persona emails as written.** Cleanup deletes the 5 current seed-managed prod patients + 5 current admins by exact email; seed re-creates them under the new addresses you paste. Drift accounts untouched. Risk: any admin you've manually granted access to in prod under those old emails loses their account.

I'll wait for your call before writing any cleanup SQL or rewriting `patients.ts`.
