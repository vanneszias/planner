# Security and privacy plan

Covers the MVP as specified in [mvp-and-roadmap.md](mvp-and-roadmap.md) and
[journeys.md](journeys.md). Edge features (WAF, DDoS protection, Turnstile)
are a layer on top; authorization, validation and tenant isolation live in the
application and are tested there.

## What we protect

| Asset                                          | Why it matters                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Minors' names, age groups, choices, attendance | Sensitive by context (children, where they'll be and when); the reason this plan is strict |
| Guardian and adult emails                      | Contact data, phishing target                                                              |
| Participant tokens and codes                   | Bearer credentials: whoever holds one sees an itinerary and can change bookings            |
| Organizer accounts                             | Access to whole participant lists                                                          |
| Allocation results and audit log               | Fairness disputes need a trustworthy record                                                |
| Availability during a booking rush             | A first-come-first-served opening is a predictable traffic spike                           |

## Threats and mitigations

### Tenant isolation

- Every query goes through the organizer or participant context helpers in
  `packages/db` ([domain-model.md](domain-model.md)); no helper accepts a bare ID.
- Every server function and `api` route resolves the context first, then checks
  the role (`viewer` is read-only), then acts.
- **Tests:** a dedicated suite that seeds two organizations and tries every
  read and write across them; it runs in CI and blocks merges.
- IDs are random (UUIDv7) and never the only check.

### Participant tokens and short codes

- The private link carries a 128-bit random token. The short code
  (`K7Q2-XA`) is a separate 6-character Crockford base32 code (no I, L, O, U),
  about a billion combinations, valid only together with its event.
- Both are stored as SHA-256 hashes, which is how they are looked up.
- **Passes (D29):** the link token is also kept sealed with AES-256-GCM under
  `PARTICIPANT_TOKEN_KEY` (a Worker secret), so a signed-in participant can show
  their own QR again. It is opened only for the signed-in owner of the
  registration (own, or a guardian's minors), and cleared at anonymisation.
  Losing the key means no passes can be shown; registration fails without it.
- **Code entry is rate-limited** (see table) and gets a Turnstile check after 3
  failures. Many failures across an event alert the organizer.
- **Tokens leave the URL immediately:** the first visit exchanges the token for
  an `HttpOnly`, `Secure`, `SameSite=Lax` cookie scoped to that registration,
  then redirects to the clean URL. This keeps tokens out of browser history,
  shared screenshots and `Referer` headers.
- `Referrer-Policy: no-referrer` on any response that still contains a token.
- **Log redaction:** request logging strips token path segments and query values.
- Organizers can regenerate a token; the old one stops working at once, and so
  does its sealed copy, which is replaced in the same write.
- **Accounts attach by verified email only** (D29). An unverified address could
  belong to someone else, so nothing is shown until the email is confirmed.
- Feed tokens (iCal) are separate and can only read the itinerary (domain model).

### Authentication (Better Auth)

- Magic link, passkeys, email and password, Google sign-in (A6).
- Session cookies `HttpOnly`, `Secure`, `SameSite=Lax`; cookie names from
  `packages/brand` config, not hardcoded.
- Passwords: minimum length 10, checked against known-breached passwords
  (Better Auth's Have I Been Pwned plugin, to verify), no composition rules.
- Better Auth's built-in rate limits stay on, backed by our limits below.
- Magic links: single use, 15-minute expiry, same neutral response whether or
  not the email exists.
- **CSRF:** `SameSite=Lax` plus an `Origin` check on every state-changing
  request. Verify what TanStack Start server functions do by default.
- Organizer sessions expire after 30 days idle; sensitive actions (deleting an
  event, changing roles, anonymising) need a session less than 12 hours old.

### Booking and registration abuse

- Turnstile (invisible) on registration.
- A registration can't hold more bookings than `sessions_per_participant`.
- Rate limits per registration and per IP plus event.
- **Someone registering with another person's email** (D23): the confirmation
  email has "Not you? Cancel this registration", and a single email can only be
  registered once per event.
- The event's Durable Object serialises writes, so a burst can't overbook; the
  guarded SQL is the second line.

### Content and uploads

- **Only organizers upload in the MVP**: event logos and workshop images.
  No participant uploads.
- Accept JPEG, PNG and WebP only, max 5 MB, checked by file signature, not by
  extension. No SVG (it can carry scripts).
- **Re-encode every upload to WebP** through the Cloudflare Images binding before
  storing in R2. WebP output discards all metadata, including GPS location from
  phone photos ([Images docs](https://developers.cloudflare.com/images/transform-images/transform-via-url/)).
  Chosen over an in-Worker encoder (S2). Check where Images processing happens
  for EU residency in M0; these are organizer images, not participant data, so
  it's lower risk, but it belongs in the sub-processor list.
- Images are served through the Worker with a fixed `Content-Type`,
  `X-Content-Type-Options: nosniff`, and long cache headers on the re-encoded
  key.
- **Organizer text** (descriptions) is a small Markdown subset rendered to
  sanitised HTML; no raw HTML.
- **CSV import:** size limit (1 MB, about 10k rows), strict parsing, per-row
  validation. **CSV export:** cells starting with `=`, `+`, `-` or `@` are
  prefixed with `'` to block formula injection in spreadsheets.

### Browser hardening

| Header                      | Value                                                                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`   | `default-src 'self'`; scripts by nonce; `connect-src 'self'` plus WebSocket; `img-src 'self' data: blob:`; `frame-ancestors 'none'`; Turnstile's domain allowed where used |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` (after domain is final)                                                                                                     |
| `Referrer-Policy`           | `strict-origin-when-cross-origin` globally, `no-referrer` on token pages                                                                                                   |
| `Permissions-Policy`        | `camera=(self)` (check-in scanner), everything else off                                                                                                                    |
| `X-Content-Type-Options`    | `nosniff`                                                                                                                                                                  |

### Live updates (WebSockets)

- The upgrade request is authenticated (organizer session or participant
  cookie) before the Durable Object accepts it.
- Messages carry seat counts and status only, never names.
- Per-IP connection limit; the object drops sockets idle for over an hour.

### `api` Worker

- iCal feeds: feed token, read-only, no personal data beyond the participant's
  own itinerary.
- Exports: generated by `jobs`, stored in the EU R2 bucket, downloaded through a
  short-lived signed link (15 minutes) after an organizer session check.
- Webhooks and API keys are Phase 3, so no key management in the MVP.

### Email

- SPF, DKIM and DMARC (`p=quarantine`, then `reject`) on the sending domain.
- Emails contain the private link but no other personal data beyond the
  recipient's own programme.

### Operations and supply chain

- Secrets via `wrangler secret`, separate per environment; nothing in the repo.
  Better Auth secret rotation documented.
- Lockfile committed, automated dependency updates, `pnpm audit` in CI, and a
  rule to prefer few, well-maintained dependencies.
- Production deploys only from CI; preview environments use separate EU
  resources and synthetic data, never copies of production.
- Organizer access to participant data is written to the audit log (viewers
  included).

## Rate limits

Using the Workers rate limiting binding: periods of 10 or 60 seconds, enforced
per Cloudflare location and approximate
([docs](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)).
That suits abuse damping, not exact quotas. WAF rate limiting rules on auth paths
add a second layer.

| Action                                    | Key          | Limit                      |
| ----------------------------------------- | ------------ | -------------------------- |
| Magic link or "Find my programme" request | email        | 3 per 60 s                 |
| Same                                      | IP           | 10 per 60 s                |
| Password sign-in                          | email        | 5 per 60 s, then Turnstile |
| Code entry                                | IP + event   | 5 per 60 s                 |
| Registration                              | IP + event   | 10 per 60 s                |
| Booking or cancel                         | registration | 20 per 60 s                |
| Ranking save                              | registration | 10 per 60 s                |
| CSV import, export request                | organization | 5 per 60 s                 |
| WebSocket connect                         | IP + event   | 10 per 60 s                |

The docs advise against IP-only keys because many users can share an IP. A
school group on one Wi-Fi is exactly our case, so IP limits are generous and
always combined with the event.

## Turnstile placement

| Where                                         | Mode                                     |
| --------------------------------------------- | ---------------------------------------- |
| Organizer sign-up                             | Always (invisible)                       |
| Password sign-in                              | After 2 failures                         |
| Magic link and "Find my programme" requests   | Always (invisible)                       |
| Participant registration                      | Always (invisible)                       |
| Code entry                                    | After 3 failures                         |
| Booking, ranking, check-in, organizer actions | Never: already behind a session or token |

## GDPR

This section is the engineering view. **For the pilot, documents are built
from vetted templates and these drafts, without a lawyer's review (S1)**; a
privacy lawyer reviews before commercial launch. With minors' data that is a
real risk, so the pilot organizer is told plainly, and the DPIA records it.

### Roles

| Data                                           | Controller    | Processor                  |
| ---------------------------------------------- | ------------- | -------------------------- |
| Participant data within an event               | The organizer | Us                         |
| Organizer accounts, platform operation         | Us            | Cloudflare (sub-processor) |
| Google sign-in (only organizers who choose it) | Us            | Google                     |

### Lawful basis and minors

- The organizer decides the lawful basis for their participants (typically
  contract or legitimate interest for running the event). Our organizer terms
  require them to have one and to inform participants.
- We never rely on a child's own consent. Minors are registered by organizers
  (D2) or reached through guardians (D24), so the age-of-digital-consent rules
  (13 in Belgium, 16 in the Netherlands, for consent-based services offered
  directly to children) shouldn't be triggered. Legal review should confirm.
- Data collected for minors is minimal: name, age group, choices, attendance,
  optional guardian email.

### Documents needed before the pilot

1. **Privacy notice** (platform and participant-facing), in English and Dutch.
2. **Organizer terms** including a **data processing agreement** (Article 28)
   and the sub-processor list (Cloudflare; Google for its sign-in).
3. **Record of processing activities** (Article 30).
4. **Data protection impact assessment, lightweight**: processing children's data
   with location and timing information is a likely trigger. Even if not
   strictly required, it's the document organizers will ask for.
5. **Breach procedure:** detect, assess, notify affected organizers without undue
   delay (they have 72 hours to notify their authority).

### Data subject rights

Participants contact the organizer (controller); the organizer acts through the
product: view and export a participant's data, correct it, delete it. Requests
that reach us are forwarded to the organizer within 2 working days.

### Retention and backups

- 90 days after the event, then anonymisation (D6, D20, D21).
- **D1 Time Travel keeps 30 days of point-in-time history** on Workers Paid
  ([docs](https://developers.cloudflare.com/d1/reference/time-travel/)), so
  anonymised data stays recoverable for up to 30 more days. The privacy notice
  says so; restores are an incident procedure, logged, and followed by re-running
  anonymisation.
- R2 exports expire through lifecycle rules (7 days).
- Logs: Workers Logs retention as short as the plan allows; IDs only.

### Cookies and analytics

- Only strictly necessary cookies (sessions, participant cookie, locale), so no
  consent banner.
- **Cloudflare Web Analytics** on public pages (S3): cookieless, aggregate
  visits, referrers and Core Web Vitals. Not on pages behind a token or login.
- No product analytics or funnels in the MVP beyond aggregate counts from our
  own database.

## Before the pilot (mandatory)

- [x] Tenant isolation test suite in CI
- [x] Concurrency test for bookings (with and without the Durable Object)
- [x] Token-to-cookie exchange, security headers (log redaction still open: implementation-plan.md, M5 review)
- [x] Rate limits and Turnstile as tabled
- [ ] Upload pipeline: type check, re-encode, metadata stripped (verified with a GPS-tagged photo)
- [x] CSV injection guard on exports
- [ ] SPF, DKIM, DMARC
- [ ] Privacy notice, organizer terms with DPA, records of processing, lightweight DPIA, breach procedure (from templates, S1)
- [x] Retention job tested end to end, including R2 snapshots
- [ ] Internal security review of auth flows

## Later

- Privacy lawyer review of all GDPR documents before commercial launch (S1)
- External penetration test before paid plans launch (Phase 3)
- API keys, webhook signing, scopes (Phase 3)
- Offline check-in data on devices (Phase 2): encrypted local storage, short expiry
- Per-event roles and facilitator access (Phase 2)
- SOC 2 or ISO 27001 only if larger customers demand it
