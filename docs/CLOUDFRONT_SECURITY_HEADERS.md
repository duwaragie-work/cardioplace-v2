# CloudFront security-headers policy (B4 hand-off)

**Owner to action:** Duwaragie / AWS migration.
**Why:** Under static export (`STATIC_EXPORT=1`) Next's `headers()` does not run — the
security headers (V-12) are dropped. `next.config.ts` in both apps returns `[]`
for headers in that mode **on purpose**, so these MUST be re-applied at the CDN
as a **CloudFront response-headers policy**. Two policies — the patient and
admin CSPs differ.

If these are not applied on the static host, the migration loses: `connect-src`
(bounds where PHI can be sent), `frame-ancestors` (clickjacking), HSTS, MIME
protection, and Referrer-Policy (admin URLs carry patient ids).

---

## Shared headers (both apps, all paths)

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

## Patient app — `Content-Security-Policy`

> `frame-src`/`img-src` allow YouTube (the homepage demo embed).

```
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://img.youtube.com; font-src 'self' data:; media-src 'self' blob: data:; worker-src 'self' blob:; manifest-src 'self'; frame-src 'self' https://www.youtube.com; connect-src 'self' https://API_ORIGIN wss://API_ORIGIN
```

## Admin app — `Content-Security-Policy`

> Tighter — no third-party frames/images; admin embeds nothing external.

```
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:; manifest-src 'self'; frame-src 'self'; connect-src 'self' https://API_ORIGIN wss://API_ORIGIN
```

### `connect-src` — substitute the real origins

`API_ORIGIN` is a placeholder. Use the **production** API host that the build's
`NEXT_PUBLIC_API_URL` points at (e.g. `api.cardioplaceai.com`), as both `https://`
and `wss://` (the voice WebSocket rides the API host; if
`NEXT_PUBLIC_VOICE_WS_URL` differs, add that origin too). This must match the
built bundle's API origin or every API call is CSP-blocked.

### Notes

- `script-src` keeps `'unsafe-inline'` — Next's App Router injects inline
  bootstrap/RSC scripts; removing it needs a per-request nonce, impossible on a
  static host. `'unsafe-eval'` is **dev-only** and never in a prod/export build.
- The **exact live value** is whatever the build emits — verify against a
  standalone build: `curl -sI https://<app> | grep -i content-security-policy`.

---

## #11 backstop (audit) — also Duwaragie

Independent of the header policy, on the CloudFront distribution:

1. **Do not log query strings** in CloudFront/S3 access logs — so any missed URL
   credential (a leaked token) does not land durably in a log.
2. For **auth + activate paths** (`/auth/*`, `/activate/*`, `/sign-in/*`,
   `/settings/close-account`), override `Referrer-Policy` to **`no-referrer`**
   (or `same-origin`) so a single-use token in a URL can't leak via Referer.

---

## Verify after cutover

```
curl -sI https://<patient-app>/ | grep -iE 'content-security-policy|strict-transport|x-frame|x-content-type|referrer-policy'
curl -sI https://<admin-app>/   | grep -iE 'content-security-policy|strict-transport|x-frame|x-content-type|referrer-policy'
```

All five headers must be present, and the patient CSP must include
`https://www.youtube.com` in `frame-src` while the admin CSP must not.
