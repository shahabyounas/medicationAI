# Medication Agent

An agent that turns a prescription into a **finished course**, and keeps the
health record that makes finishing it mean something.

Not a reminder app. An alarm fires at a fixed time and gives up; this holds a
goal — *all 21 doses taken* — and keeps choosing actions until the goal is met
or a human takes over. It plans the schedule from the prescription, picks the
channel, decides when to escalate, adapts to when the patient actually takes
things, replans after a miss, and brings in family only as a last resort.

It also holds the other half of the picture: what the patient measured, how they
said they felt, what a medicine did to them, what the tests said, and everything
they take that no doctor prescribed. Without that the record can say twenty-one
tablets went in and call the illness resolved, having never asked anybody whether
they got better.

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

**Start here:** the app has no data until you add some. Press **+ Prescription**
on the Medicines screen, or run `npm run seed` for the worked scenario — Tom, day
4 of a 7-day course, with four months of blood pressure readings, a vitamin he
takes himself, a reported side effect, a follow-up booked, and a penicillin
allergy on his record.

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

There is no fake phone bezel, and no drawn status bar either — the phone has a
real one, directly above, and a second frozen clock under it only ever looked
broken. The layout is the real thing at both sizes:

| Width | Shell |
| --- | --- |
| `< 900px` | Full-bleed app, bottom tab bar, full-screen steps, safe-area insets |
| `>= 900px` | Sidebar navigation, centred reading column, steps as modal dialogs |

The steps are modal in the full sense: Tab stays inside one, focus moves in when
it opens and back to whatever opened it when it goes. Every step closes three
ways — a button in the corner, Escape, and a click on the scrim beside it.

Two of them used to close no way at all. The read-back and the intake form were
deliberately undismissable, on the reasoning that a step existing to be answered
should not be waved away by a stray keystroke. In the hand that reads as a
jammed app: no visible exit, and a dead Escape key. The read-back had no back
button either, so its only exits were its two answers. Now the form asks before
discarding what you typed, and closing the read-back means the same as "not
yet" — which is a real state the home screen can get you back out of, rather
than a prescription dropped on the floor.

It installs as a PWA — web manifest, maskable icons, standalone display, and a
service worker that precaches the built shell so a cold start works offline.

### Reminders that arrive with the app closed

Web Push, which is the difference between a reminder and a thing you have to
already be looking at. **Reminders → Turn on reminders** registers the browser;
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
| `Patient` | Mealtimes (the planner's anchors), timezone, allergies, one family contact |
| `Doctor` | A doctor actually seen — reused across conditions, not a string on a prescription |
| `Visit` | One appointment: reason, diagnosis, notes, vitals, follow-up |
| `Condition` | The thing being treated; groups medicines and detects recurrence |
| `Prescription` | What the doctor wrote. Immutable — the agent never edits it |
| `Course` | A prescription line turned into a plan the agent executes |
| `Dose` | One tablet-taking event. 21 of these are "3× a day for 7 days" |
| `EscalationState` | The agent's cursor in the graph, one per chased dose |
| `AgentEvent` | Everything the agent did, so nothing it does is invisible |
| `Reading` | A number the patient measured about themselves |
| `SymptomEntry` | How ill they said they felt, one answer a day |
| `SideEffectReport` | A medicine making them worse — filed against the medicine, not the course |
| `Appointment` | One that has not happened yet, and the reminders sent for it |
| `LabResult` | A test result, transcribed as printed |
| `Immunisation` | A jab, and when the next is due |
| `HealthDocument` | A photograph of the paper |

`Prescription` and `Course` are separate on purpose: the doctor's instruction
stays a faithful copy of the paper while the plan around it is rearranged.

The second half of that table is the **outcome** side of the record. The first
half says what a doctor wrote and what the patient swallowed; on its own that
cannot answer whether any of it worked — the app used to declare an illness
resolved because the tablets ran out, having never asked anybody how they were.

### The planner

"Three times a day for 7 days, after food" becomes 21 instants placed around
*this* patient's mealtimes, with inter-drug spacing applied. It is pure, so it's
the most thoroughly tested part of the system — including the two cases that
quietly break schedulers:

- **Starting mid-day.** Confirming the medicine at 2pm doesn't silently drop the
  morning dose. The course shifts and still delivers all 21, finishing a day
  later — the count is what matters clinically, not the end date.
- **Daylight saving.** "8am" stays 8am across the transition.

Reading the plan back needs the same care. "Today" on the home screen is a
calendar day where the patient is standing, not UTC's — those are the same
window only in UTC itself. Taken as UTC midnight on the patient's date, a New
York day starts at 8pm the evening before, and the 8:30pm dose falls off the end
of the screen while the previous evening's takes its place. Nothing errors; the
screen just quietly shows the wrong tablets. It is pinned to real instants in
two zones in `viewService.test.ts`.

---

### 4. The two reasons people stop

The agent's one intervention for a patient who stops a course is the day 3–4
nudge, and it is built for the patient who stopped because the symptom went
away. That is only one of the two reasons. The other is that the medicine is
making them ill — and the right response to that is the opposite one.

So **"It's not agreeing with me"** is a flow in its own right, on every medicine
and on the dose screen. Reporting one does three things, each a promise the copy
then makes out loud:

1. **Files the report against the medicine**, not the course, so it survives the
   course ending and shows up the next time that medicine is prescribed.
2. **Stops the chasing** when the report warrants it — anything past mild, or
   anything the patient has acted on by stopping already. That means settling
   every open ladder *and* marking the course `pausedAt`, because the loop
   activates any dose whose time has come and opens a fresh ladder for it: a
   paused course without the marker would be told "I've stopped reminding you"
   and then reminded four hours later. (`sideEffectService.test.ts` pins exactly
   that.)
3. **Puts the prescriber's phone number on screen**, because the next move
   belongs to a person.

What it never does is decide. It does not stop the course — stopping a course of
antibiotics halfway is itself a clinical act, which is why this app exists — and
it does not say whether the symptom is serious. It pauses the *reminders*, and
the doses stay on the record as owed, so nothing is lost if the doctor says
carry on. A skipped dose can now carry a reason too; `stopped_early` with
nothing attached is what made "I felt better" and "it was making me ill"
indistinguishable.

### 5. The medicines nobody prescribed

Most of what people take is not on a prescription: the vitamin D every morning,
the ibuprofen in the drawer, the cod liver oil a daughter swears by. An app that
only knows about prescribed medicine has an incomplete list of what is going
into the patient — incomplete at exactly the moment the list is wanted, when
somebody in a clinic asks what they are on.

**+ Something I take** sits beside **+ Prescription** with equal weight. Three
things make it deliberately not an intake:

- **No prescription is created.** `Course.prescriptionId` became nullable for
  this. Fabricating a prescription for a supplement would put an invented
  document in the one part of the record meant to be a faithful copy of paper.
- **No read-back, and no "do you have it yet?".** That question exists because
  the gap between the surgery and the chemist desynchronises a schedule.
  Somebody adding the tub already in their cupboard has no gap.
- **Reminders are off by default**, and `Course.remindersOn` records it. Without
  that field the open-ended top-up loop adopts a no-reminder supplement, plans a
  fortnight of doses, and escalates them to the patient's son — which it did,
  until `selfCareService.test.ts` caught it.

One more trap, also caught by a test: doses are planned from **today**, never
from `startedAt`. Somebody recording honestly that they have taken vitamin D
since June is telling the record when they started, not asking for four months
of doses — every one of which the activation pass would write off as missed,
wrecking every adherence figure and tripping the rule that texts their family.

### 6. Allergies, checked before the first dose

`Patient.allergies` is checked by name whenever a medicine is added, and the
flag appears on the read-back — the last screen before the clock starts.

It is a substring match and the copy says so: *"Your record says you have had a
severe reaction to Penicillin (rash). This prescription is for Penicillin V 250mg.
I cannot tell whether those are related — please check it with Dr. Iqbal before
you start."* It states a fact and hands the question to a human. It does not
block the prescription, and there is a test asserting that it does **not** flag
amoxicillin for a penicillin allergy — because it genuinely cannot know that,
and the feature must not be mistaken for a safety net.

### 7. Appointments the agent actually reminds you about

`Visit.followUpDate` was collected at intake from the first version and used for
one thing: a line of grey text. An agent that will chase a single tablet through
five channels over four hours was told "come back in three weeks" and did
nothing at all.

`Appointment` is its own record, and the tick sends three fixed rungs — a week
before, the day before, the morning of. Not the dose ladder, because the two are
not the same shape: a dose is chased *because it is late* and stops when
confirmed, while an appointment is announced *before* it and has nothing to
escalate to. There is no point ringing somebody's son because the surgery is on
Tuesday. Rungs are recorded before the push is attempted, so a failing push
service cannot turn one reminder into one per tick for a week; and a rung whose
moment has passed is skipped rather than fired late, because a "tomorrow"
reminder arriving on the day tells the patient the wrong thing.

Follow-up dates already on visits are **offered**, not booked: "come back in
three weeks" on a note is frequently an instruction to ring the surgery rather
than an appointment that exists.

### 8. The charts

A new **Health** tab, and the first analytics surface in the app. Everything on
it was already in the database and none of it was on a screen: the planned and
actual time of every dose, the anchor each hangs off, the drift the agent taught
itself, which rung settled each chase. A patient could see a progress bar.

| Chart | What it answers |
| --- | --- |
| Adherence by mealtime | *Which dose is the one I miss?* — and it sits next to the mealtimes editor, the control that fixes it |
| Dose grid | Every tablet of a course, days down and doses across |
| Burn-down | The plan against what happened, and how many tablets are still owed |
| How you felt vs doses taken | The product's own thesis, about this patient |
| Punctuality | When a dose was due against how late it was taken — and `learnedDriftMinutes`, finally visible |
| Month by month | Adherence over the whole record |
| Illness timeline | Every illness end to end, with an arrow from an abandoned course to the recurrence |
| Which nudge worked | How often each rung of the ladder was the one that went out |
| Readings | Blood pressure, weight, blood sugar and the rest, against the range on the monitor's own leaflet |

Three rules run through all of it:

- **Patterns, not scores.** "You are 81% adherent" is a mark out of ten for
  being ill. "Your supper dose is missed three times as often as the other two,
  and your supper is set to 20:00" is something to go and change.
- **Honest denominators.** Nothing is counted against a dose whose time has not
  come. Mid-course, "8 of 21" reads as failure when thirteen were never due.
- **Colour is never the only channel.** Green against red is precisely the pair
  a red-green colourblind reader cannot separate, and it is the most important
  distinction in the app — so every grid cell carries a glyph, every legend
  names its states in words, and every chart has a **Numbers** view holding the
  same information with no colour at all. "Taken" and "taken late" share one
  colour on purpose: a separate amber sat 9.5 ΔE from the red of a miss, below
  the threshold at which anybody can tell two marks apart, so lateness is a
  notch on the corner and has a chart of its own.

There is one axis, always. Severity runs 0–10 and doses run 0–3; they share a
day axis as two stacked plots rather than two y-scales on one, because a second
scale invents a correlation that is not in the data.

### 9. One page to hand a clinician

The record was good and completely trapped. A clinician has ninety seconds and
is not going to tap through three screens of somebody else's phone, so every
appointment began with the patient reciting from memory the exact facts the app
was holding.

**Show this to a doctor** is that record on one printable page, in the order it
is actually asked in: allergies, then what they are taking now, then what they
are being treated for, then the numbers. Self-managed medicines are in the same
list as prescribed ones, marked but not separated — "what are you taking?" has
one answer, and a supplements section at the bottom is a section that gets
missed. A print stylesheet drops the app's chrome so the browser's own
*Print → Save as PDF* produces a file; nothing is uploaded and nothing leaves
the phone unless the patient sends it.

The provenance note at the foot is not boilerplate. Somebody reading an
adherence figure at a desk needs to know it is what an app observed rather than
what was swallowed, and that no clinician has reviewed a word of it.

### 10. Readings, results, jabs and photographs

- **Readings** are the only series the patient owns outright, and the only thing
  a chronic condition has to show for itself — `isChronic` existed from the
  start with nothing behind it, because a long-term condition has no course to
  finish and no tablet to count. The nurse's measurements are the *same* series:
  blood pressure used to live on the visit as the string `"138/82"`, which
  cannot be a point on a chart, so it is now two numbers.
- **Results** are transcription, never interpretation. The flag beside a line is
  the H or the L the lab printed, copied across — never computed by comparing
  the value against the range, because deciding a number is abnormal is the one
  thing this app must not do. A test done twice becomes a line.
- **Immunisations** carry a next-due date, which makes them the one record that
  can also be reminded about.
- **Photographs** of the prescription or the letter, downscaled in the browser
  to fit under a 1.5MB cap, stored in Mongo and projected out of every list so a
  record screen does not get slower the more it holds.

### 11. The things that had nowhere to live

- **A refill.** `needsRefillWarning` and `unitsRemaining` existed from the
  start and nothing ever put units *back*, so the warning fired once and could
  never be cleared — the patient was told they were running out every time they
  took a tablet, having already been to the chemist. **I collected more** asks
  for a count, because the only reliable way to know how many tablets are in a
  house is for somebody to look in the packet.
- **A profile.** There was no profile screen at all, which stranded two things.
  The allergy list is new and must be editable by definition. The family contact
  was not: it has been the ladder's last rung since the first version, and no
  screen could add, change or remove the person who gets the phone call. It was
  seed data or nothing.

## Guardrails

The agent never changes a dose, never diagnoses, never recommends a medicine. It
only repeats and schedules what the doctor wrote.

This is structural, not aspirational: every sentence it can say lives in
[`packages/shared/src/agent/messages.ts`](packages/shared/src/agent/messages.ts)
as a fixed template. There is no runtime text generation, so it cannot compose
clinical advice even in principle.

---

## The attention cue

When a dose is due or has been missed, the **Record** tab turns red and blinks a
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
| `npm test` | 191 tests — 70 pure, 109 integration against real MongoDB, 12 rendering |
| `npm run typecheck` | All three packages |
| `npm run verify` | typecheck → test → build |
| `npm run vapid` | Generate a VAPID keypair for push |
| `npm run mongo:up` / `mongo:down` | The database container |

The rendering tests run the screens in `react-dom/server` against **captured API
responses**, parsed through the same Zod schemas the client parses them with — so
a fixture that has drifted from the contract fails there rather than passing a
test and breaking the app. What they catch is the class of failure a typechecker
cannot: a chart dividing by a zero-length array, a `toFixed` on a null, a day
holding fewer doses than the widest day. Several assert only that no chart
renders the string `NaN`, which is the shape that bug always takes.

The integration tests run against a real MongoDB (`medication_ai_test`), not a
mock. The loop is *defined* by what it does to persisted state across ticks, and
a mocked driver would assert the calls this code makes while proving nothing
about the behaviour that matters.

---

## API

| Route | Purpose |
| --- | --- |
| `GET /api/patients/:id/history` | Home screen: the lifetime record, newest first, with today's doses at the top |
| `GET /api/conditions/:id/history` | One illness in full: visits, courses, every dose and the time it was taken |
| `GET /api/patients/:id/today` | The day on its own: next dose, nudge, progress, activity |
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

The outcome side of the record — reads hang off the patient, because every one
of them is "this patient's X"; writes are their own resources:

| Route | Purpose |
| --- | --- |
| `GET /api/patients/:id/insights` | Everything the charts screen draws, in one payload |
| `GET /api/patients/:id/readings` | Every metric's series, including the empty ones |
| `GET /api/patients/:id/appointments` | Upcoming, past, and the follow-up dates never acted on |
| `GET /api/patients/:id/side-effects` | Open, settled, and one row per medicine ever reported against |
| `GET /api/patients/:id/results` | Test results, trends, jabs and documents |
| `GET /api/patients/:id/share` | The one-page summary for a clinician |
| `GET /api/patients/:id/profile` → `PATCH` | Details, allergies and the family contact |
| `POST /api/side-effects` | "This medicine is making me worse" |
| `PATCH /api/side-effects/:id` | It settled down, or the doctor has been told |
| `POST /api/courses/:id/resume` | "My doctor said to carry on" |
| `POST /api/courses/:id/refill \| /stop` | Units back on the shelf; end a course with a reason |
| `POST /api/self-care` | Something the patient takes that nobody prescribed |
| `POST /api/self-care/:id/stop` | They have stopped taking it — not a course abandoned |
| `POST /api/readings` / `DELETE /api/readings/:id` | A measurement |
| `POST /api/symptoms` | How ill they feel today, 0–10 |
| `POST /api/appointments` → `PATCH` / `DELETE` | Book one, mark it attended or missed |
| `POST /api/visits/:id/appointment` | Turn a visit's follow-up date into a reminded appointment |
| `POST /api/lab-results` / `/api/immunisations` | Transcribe a result, record a jab |
| `POST /api/documents` → `GET /api/documents/:id` | A photograph of the paper |

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

### No scheduled tick

`vercel.json` declares no cron. Vercel **Hobby** allows a daily one at most,
which is useless to a ladder measured in minutes — a once-a-day rung is not a
reminder — so rather than ship a schedule that only looks like it works, the
deployment has none.

**The open app is the clock instead.**
[`packages/web/src/agentClock.ts`](packages/web/src/agentClock.ts) posts
`/api/agent/tick` when the app opens, when it comes back to the foreground, and
once a minute while it is being looked at. A frozen function has no timer, but a
request arriving is exactly what wakes one — and the app being open *is* a
request arriving. Without it the deployment looks finished and does nothing: no
dose ever turns `due`, no reminder is ever sent, and nothing reports an error.

Ticks are safe to repeat and safe to run from several devices at once, because
the cursor lives in MongoDB and a tick is a function of persisted state rather
than of who called it. A failed tick is silent — it is housekeeping the patient
did not ask for, and the reads behind each screen report their own failures.

`GET /api/agent/tick` is still there, still guarded by `CRON_SECRET`, so turning
it on later is one block in `vercel.json` and no code change:

```json
"crons": [{ "path": "/api/agent/tick", "schedule": "*/5 * * * *" }]
```

That interval needs **Pro**; on Hobby the deploy is rejected outright.

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
- **No carer access.** The app still takes `patients[0]`, and the family contact
  is notify-only: the son can be texted but cannot see or do anything. For the
  patient this is built for, the carer is often the primary user — this is the
  largest remaining gap.
- **No photo-to-form.** A prescription can be *photographed* and kept beside the
  record, but the four typed steps are still the only way to get its contents
  in. The camera step that would fill the form remains the obvious adoption fix.
- **The allergy check is a name match.** It will not know that amoxicillin is a
  penicillin, the copy says so, and there is a test asserting it does not
  pretend otherwise. It catches the obvious case; it is not a safety net.
- **Documents live in Mongo as base64**, capped at 1.5MB with the browser
  downscaling to fit. There is no object store, and adding one would mean a
  second set of credentials and a second thing to pay for in exchange for
  photographs of single sheets of A4.
- **No dark mode for the charts.** The app's design system is light-only; the
  chart palette is validated against its white and sand surfaces, and a dark set
  would need its own steps validated against a dark surface rather than an
  automatic flip.
- **No "Ask the agent" chat.** The design's fourth tab is a chat with canned
  replies. A chat that isn't backed by a model would either be a fake or would
  breach the guardrail above, so the tab is the medical record instead.
