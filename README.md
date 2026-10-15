# Medication Agent

An agent that turns a prescription into a **finished course**.

Not a reminder app. An alarm fires at a fixed time and gives up; this holds a
goal — *all 21 doses taken* — and keeps choosing actions until the goal is met
or a human takes over. It plans the schedule from the prescription, picks the
channel, decides when to escalate, adapts to when the patient actually takes
things, replans after a miss, and brings in family only as a last resort.

Built from the [Claude Design project](https://claude.ai/design/p/fc547bbe-c3f9-4a58-9e13-b349f10f3b27),
plus a doctors-and-visits medical record. Installable as a PWA; responsive from
phone to desktop.

---

## Quick start

```bash
npm install
npm run mongo:up     # MongoDB in Docker, on port 27018
npm run vapid        # push keys — paste the output into .env
npm run seed         # loads the design's scenario
npm run dev          # API on :4100, web on :5173
```

Then open <http://localhost:5173> (use `localhost`, not `127.0.0.1` — Vite
binds IPv6).

**Start here:** the app has no data until you add some. Press **+ Add a
prescription** on any screen, or run `npm run seed` for the design's worked
scenario (Nasreen, day 4 of a 7-day course).

> **Why 27018?** A MongoDB already running on your machine binds
> `127.0.0.1:27017` *specifically*, which beats Docker's `0.0.0.0` binding. The
> clash doesn't fail — it silently routes every read and write to the wrong
> database. The bundled container uses its own port so that can't happen. To use
> your own instance instead, set `MONGODB_URI`.

Copy `.env.example` to `.env` to change anything.

---

## How it works

### 1. Escalation is a graph

The whole chase policy is one table in
[`packages/shared/src/agent/graph.ts`](packages/shared/src/agent/graph.ts):

```
reminder_1 ──15m──▶ reminder_2 ──30m──▶ text_message ──75m──▶ check_in
     │                                                            │
     └────────────────── 60m ──▶ notify_family ──60m──▶ replan ──▶ exhausted
```

Any node jumps straight to `resolved` the moment the patient confirms. Family is
always the **last** rung before replanning, never the first — being chased by
your son over a tablet is what makes people abandon these apps.

Adding a rung, reordering channels or changing a timing is an edit to that one
table. Nothing else knows the ladder exists.

### 2. Getting a prescription in

**+ Add a prescription** is the entry point, on every screen and in the
sidebar. Four steps, one decision each:

1. **Who did you see?** — pick a doctor already on the record, or add a new one.
2. **What did they say?** — date, reason, diagnosis, notes, follow-up.
3. **What did they give you?** — one or more medicines, with dose, frequency,
   food rule and duration. It shows the running total ("= 21 in total").
4. **Is this right?** — review, then the agent reads it back in plain words and
   asks the one thing it cannot infer: *do you have the medicine at home?*
   That answer starts the clock.

The whole thing is one `POST /api/intake`, because it is one act. Letting the
browser orchestrate four dependent writes would leave a half-written record
behind whenever one of them failed.

**The doctor rule:** choosing someone already on the record files a **new visit
against them** — it never creates a second "Dr. Iqbal". Typing a name that
already exists collapses onto the existing doctor too (case-insensitively), so
the record stays useful. Only a genuinely new name creates a doctor. That is
what makes "Dr. Iqbal · 3 visits · treated you for chest and throat infections"
possible at all.

### 3. The loop just walks the graph

[`packages/server/src/agent/runner.ts`](packages/server/src/agent/runner.ts)
does exactly three things per tick:

| Step | What it does |
| --- | --- |
| **Top up** | Plans further doses for open-ended courses before they run dry |
| **Activate** | Any dose whose time has come becomes `due` and gets a fresh ladder |
| **Advance** | Any ladder whose next rung is due runs it and moves the cursor on |

The cursor lives in MongoDB (`escalation_states.nextRunAt`), not in memory, so
ticks are idempotent and a restart resumes mid-ladder instead of starting over
or double-sending. A dose whose entire window elapsed during downtime is
recorded as missed rather than reminded about hours late.

Drive it by hand — a medication schedule plays out over days:

```bash
curl -XPOST localhost:4100/api/agent/tick \
  -H 'content-type: application/json' \
  -d '{"now":"2026-08-12T14:30:00Z"}'

curl localhost:4100/api/agent/deliveries   # what it actually sent, and to whom
```

---

## Responsive, and installable

There is no fake phone bezel. The layout is the real thing at both sizes:

| Width | Shell |
| --- | --- |
| `< 900px` | Full-bleed app, bottom tab bar, full-screen steps, safe-area insets |
| `>= 900px` | Sidebar navigation, centred reading column, steps as modal dialogs |

It installs as a PWA — web manifest, maskable icons, standalone display, and a
service worker that precaches the built shell so a cold start works offline.

### Reminders that arrive with the app closed

Web Push, which is the difference between a reminder and a thing you have to
already be looking at. **Family → Turn on reminders** registers the browser;
`POST /api/push/subscribe` stores the endpoint against the patient.

A reminder notification carries **I took it** and **Not yet**. "I took it"
confirms the dose from the lock screen — the service worker posts it directly
and the app is never opened. If that post fails it says so rather than
swallowing it, because a dose the patient believes is recorded and is not is the
worst outcome available.

Reminders are tagged per dose, so the second reminder *replaces* the first
instead of stacking up a wall of them.

Push needs VAPID keys:

```bash
npm run vapid        # prints a keypair; paste into .env, then restart
```

Without them the server reports push as unconfigured and the UI says exactly
that. Reminders silently going nowhere would be far worse than an honest "not
set up".

**Dead endpoints are pruned.** A push endpoint outlives the browser that made
it — people clear site data, reinstall, change phones. `404` and `410` mean it
is gone for good and the subscription is deleted; anything else is treated as
transient and counted, so a bad afternoon at the push service does not
unsubscribe everybody. That rule is `verdictForFailure`, tested exhaustively.

The service worker is deliberately narrow about what it will serve from cache,
because this app answers "have I taken my tablet?" and a stale answer there can
mean a double dose:

- **App shell** — cache-first, refreshed in the background.
- **API reads** — network-only. Never served from cache; offline it fails and
  the UI says so.
- **Mutations** — passed straight through, never queued. Replaying "I took it"
  later would record a dose at a time it did not happen.

To exercise it, you need a production build (the worker is disabled in dev, where
it would only serve stale modules):

```bash
npm run build -w @medication-ai/web
npm run preview -w @medication-ai/web   # :4173, proxies /api to :4100
```

## Layout

```
packages/
  shared/   Zod schemas + pure agent logic (graph, planner, adherence, copy)
  server/   Express + MongoDB driver + the agent loop
  web/      React UI
```

**Zod is the single definition of every model.** No ODM — an ODM would mean
writing each model twice and keeping the two in step. Documents are parsed
through their schema on the way out of the database, and every HTTP response is
validated by the server on the way out *and* the client on the way in, so a
contract break surfaces at the boundary with the field named rather than as
`undefined` three components deep.

### The domain

| Model | What it is |
| --- | --- |
| `Patient` | Mealtimes (the planner's anchors), timezone, one family contact |
| `Doctor` | A doctor actually seen — reused across conditions, not a string on a prescription |
| `Visit` | One appointment: reason, diagnosis, notes, vitals, follow-up |
| `Condition` | The thing being treated; groups medicines and detects recurrence |
| `Prescription` | What the doctor wrote. Immutable — the agent never edits it |
| `Course` | A prescription line turned into a plan the agent executes |
| `Dose` | One tablet-taking event. 21 of these are "3× a day for 7 days" |
| `EscalationState` | The agent's cursor in the graph, one per chased dose |
| `AgentEvent` | Everything the agent did, so nothing it does is invisible |

`Prescription` and `Course` are separate on purpose: the doctor's instruction
stays a faithful copy of the paper while the plan around it is rearranged.

### The planner

"Three times a day for 7 days, after food" becomes 21 instants placed around
*this* patient's mealtimes, with inter-drug spacing applied. It is pure, so it's
the most thoroughly tested part of the system — including the two cases that
quietly break schedulers:

- **Starting mid-day.** Confirming the medicine at 2pm doesn't silently drop the
  morning dose. The course shifts and still delivers all 21, finishing a day
  later — the count is what matters clinically, not the end date.
- **Daylight saving.** "8am" stays 8am across the transition.

---

## Guardrails

The agent never changes a dose, never diagnoses, never recommends a medicine. It
only repeats and schedules what the doctor wrote.

This is structural, not aspirational: every sentence it can say lives in
[`packages/shared/src/agent/messages.ts`](packages/shared/src/agent/messages.ts)
as a fixed template. There is no runtime text generation, so it cannot compose
clinical advice even in principle.

---

## The attention cue

When a dose is due or has been missed, the **Today** tab turns red and blinks a
dot — in the bottom bar on a phone, in the sidebar on a desktop. It is tied to a
real outstanding dose and clears the moment one is confirmed, because a badge
that is always lit stops being information within a day. Under
`prefers-reduced-motion` the blink stops but the red dot stays, so the
information survives without the movement.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API and web together |
| `npm run seed` | Reset to the design's scenario (day 4 of 7) |
| `npm test` | 112 tests — 70 pure, 42 integration against real MongoDB |
| `npm run typecheck` | All three packages |
| `npm run verify` | typecheck → test → build |
| `npm run vapid` | Generate a VAPID keypair for push |
| `npm run mongo:up` / `mongo:down` | The database container |

The integration tests run against a real MongoDB (`medication_ai_test`), not a
mock. The loop is *defined* by what it does to persisted state across ticks, and
a mocked driver would assert the calls this code makes while proving nothing
about the behaviour that matters.

---

## API

| Route | Purpose |
| --- | --- |
| `GET /api/patients/:id/today` | Home screen: next dose, nudge, progress, activity |
| `GET /api/patients/:id/medicines` | Medicines grouped by condition |
| `GET /api/patients/:id/visits` | Doctors and visit history |
| `GET /api/patients/:id/family` | Contacts, escalation order, recent alerts |
| `POST /api/doses/:id/take \| snooze \| skip` | The three things a patient can do |
| `POST /api/intake` | A whole prescription: doctor, visit, condition, medicines |
| `GET /api/intake/options` | Existing doctors, conditions and medicines to pick from |
| `POST /api/prescriptions/:id/confirm` → `/start` | Read back → "yes, I have it" |
| `GET /api/conditions/:id/report` | End-of-course report |
| `GET /api/push/public-key` | The VAPID key the browser subscribes with |
| `POST /api/push/subscribe` / `/unsubscribe` | Register or forget a device |
| `POST /api/push/test` | Send a test notification to every registered device |
| `POST /api/agent/tick` | Advance the agent one step |
| `GET /api/agent/tick` | The same step, for Vercel Cron (which only sends GET) |
| `GET /api/agent/escalation-path` | The ladder, walked from the graph |
| `GET /api/agent/deliveries` | What the agent sent |

Doctors, visits and conditions have full CRUD under `/api/doctors`,
`/api/visits`, `/api/conditions`.

---

## Deployment

Deployed to **Vercel**, with MongoDB on **Atlas**. Both halves live on one
origin — the PWA as static files, the API as a single serverless function — so
the browser calls `/api/...` exactly as it does locally. No CORS, no second
domain, no API base URL baked into the build.

```
vercel.json
  buildCommand   → packages/web/dist      (the PWA)
  rewrites       → /api/(.*) → /api       (everything else)
  functions      → api/index.ts           (the whole Express app)
```

`api/index.ts` re-exports `packages/server/src/serverless.ts`: the same
`createApp()` as local, with a different lifecycle around it. Setup is lazy and
cached per container, so the first request pays for the Mongo connection and the
index check and the rest pay nothing.

### One function, not one per route

One cold start and one connection pool to reason about, rather than one of each
per endpoint. Express is already the router; splitting it across files would
mean duplicating that routing in the filesystem.

### What changes when it is not a long-lived process

Two things, and they are the only reasons any of this needed writing:

- **The connection is cached on `globalThis`, and the cached value is the
  *promise*.** A warm container may re-evaluate the module, and two requests can
  land on a cold one at once; caching the resolved `Db` in module scope would
  open a second socket in both cases. The pool is capped at 10 for the same
  reason — every concurrent lambda holds its own, and that is how a shared Atlas
  cluster runs out of connections.
- **There is no agent loop.** `setInterval` inside a function that gets frozen
  between requests fires unpredictably or never. Vercel Cron calls
  `GET /api/agent/tick` instead, guarded by `CRON_SECRET`.

### Setup

Four environment variables in the Vercel project (Production *and* Preview):

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | The Atlas `mongodb+srv://...` string |
| `MONGODB_DB` | `medication_ai` |
| `CRON_SECRET` | Any long random string; Vercel sends it as a bearer token |
| `AGENT_LOOP_ENABLED` | `false` — the cron drives the tick, not a timer |

Plus `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` if you want push
(`npm run vapid` generates the pair). Without them the app says push is
unconfigured rather than failing.

Atlas needs **Network Access → `0.0.0.0/0`**: Vercel's functions have no static
egress IP to allowlist.

### The cron interval is plan-bound

`vercel.json` ships `0 6 * * *` — once a day — because that is the most a Vercel
**Hobby** account permits, and a schedule it rejects fails the deploy. That is
far too slow for an escalation ladder measured in minutes. On **Pro**, change it
to the interval the agent was designed for:

```json
"crons": [{ "path": "/api/agent/tick", "schedule": "*/5 * * * *" }]
```

Until then the ladder only advances when something calls the tick —
`POST /api/agent/tick`, which the app's own demo control already does.

---

## What isn't built

Honest list, so nobody assumes otherwise:

- **No real delivery.** `ConsoleDeliveryChannel` logs and records what *would*
  have been sent. A real provider is one implementation of `DeliveryChannel`;
  nothing pretends to have been delivered that wasn't.
- **No auth.** Every route trusts its `patientId`. This is single-tenant demo
  scaffolding, not a system to put real patient data in.
- **No QR/OCR ingestion.** Prescriptions are typed in through the intake form.
  The read-back screen the design shows is built; only the camera step that
  would fill the form for you is missing.
- **No SMS or WhatsApp.** Rungs 3 and 4 of the escalation ladder (`text_message`,
  `check_in`) and the family alert are recorded and logged, not sent — there is
  no provider account attached. `DeliveryChannel` is where one plugs in; push is
  already a real implementation of it, so the shape is proven.
- **Push delivery is not covered by automated tests.** Web Push mandates HTTPS
  endpoints and a real subscription can only be minted by a browser talking to
  its vendor's service, neither of which exists in CI. What *is* tested: the
  retention policy, subscription storage, and — by injecting push events into a
  real browser — the notification the service worker builds and its buttons.
  The encrypted HTTP leg itself is `web-push`'s.
- **No "Ask the agent" chat.** The design's fourth tab is a chat with canned
  replies. A chat that isn't backed by a model would either be a fake or would
  breach the guardrail above, so the tab is the medical record instead.
