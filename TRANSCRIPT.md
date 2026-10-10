MentorMatch — AI Development Transcript and Implementation Notes

**Candidate**: Ayushi Choudhary
**Institute**: Haldia Institute of Technology (HIT)
**Assignment**: Full-Stack Engineer — Trial Class Booking System
AI assistant recorded in this document: DeepSeek (chat.deepseek.com)

Note on AI usage

As encouraged by the assignment brief, an AI assistant was used during development. This document is organized by feature area and records prompts plus corresponding response/implementation notes. It is not a verbatim, complete export of every chat turn: intermediate iterations and some repeated fixes have been summarized. If the evaluator requires the full transcript, attach or append the original conversation export as well.

Descriptions of implementation and test results below are claims recorded during development; they should be treated as verified only when they match the current repository and can be reproduced. All credentials, connection strings, and API keys must be redacted.

PART 1 — Project Setup and Architecture

Prompt:
I want to build a full-stack web application called MentorMatch. Parents browse mentors and book trial classes for their children. React/Vite frontend, Node/Express backend, MongoDB with Mongoose, JWT auth with bcrypt, timezone-aware scheduling, email notifications, responsive CSS.

Project objective: parents browse available mentors and book a trial-class slot. Both parties receive an email with a clearly labelled demo-class link. The link is a placeholder and does not itself provide a real video call.

Requirements:

Parents register and log in.

Mentors register and log in.

Parents browse mentors.

Parents book trial classes.

Parents and mentors receive notifications.

All times handled correctly across time zones.

A mentor conducts at most two demo classes per day.

A clear error state when no mentor is available.

Do not build everything at once. Start with the folder structure, health check, and run instructions.

Response:
Scaffolded the backend and frontend.

Backend structure:

src/server.js — boots the app: validates env, connects to MongoDB, awaits index initialization, starts listening. Registers SIGINT/SIGTERM handlers for graceful shutdown.

src/app.js — Express app, CORS, JSON body parsing (1 MB limit), route mounting, 404 handler, and a centralized error handler that maps Mongoose validation/cast errors and duplicate-key errors to appropriate 4xx codes.

src/config/environment.js — validateEnvironment() fails fast if MONGODB_URI or JWT_SECRET is missing, if the URI scheme isn't mongodb:// / mongodb+srv://, or if JWT_SECRET is shorter than 32 chars.

src/config/database.js — connectDatabase() connects and awaits model.init() on all four models so unique indexes exist before requests are served.

src/constants.js — supported timezones, booking limits, class duration.

Frontend: React + Vite. App.jsx acts as the top-level orchestrator; feature sections live in src/components/.

GET /api/health returns { status, service, database } — 200 when MongoDB is connected, 503 otherwise.

Run locally:

Backend: cd backend && npm install && npm run dev → http://localhost:5000

Frontend: cd frontend && npm install && npm run dev → http://localhost:5173

PART 2 — Authentication (Parent and Mentor)

Prompt:
Implement secure authentication for two roles: parent and mentor. Store name, email, hashed password, and timezone. Use bcrypt for hashing, JWT for sessions. Prevent unauthorized role assignment. Return appropriate HTTP status codes. Never store plaintext passwords. On the frontend: registration and login screens, validation errors displayed, and a session that survives a page refresh.

Response:
Two separate Mongoose models — Parent and Mentor — rather than a single User with a role field. This keeps role-specific fields on the appropriate schema (mentor: bio, subjects, availability, timezone; parent: timezone) and avoids a document with many optional fields that only apply to one role.

Passwords: bcryptjs with 12 salt rounds. validatePassword() enforces 8–72 bytes (bcrypt silently truncates past 72). passwordHash is select: false — it never leaves the database unless explicitly requested.

Registration accepts { name, email, password, timezone }. The email is normalized (lowercased, trimmed) and checked against both collections. timezone is validated against the runtime's IANA list and falls back to "UTC" if missing or invalid.

JWT payload includes sub, role, name, and timezone. This lets the client restore a session without a server round-trip on every page load. Expiry is 12 hours.

requireAuth verifies the token and re-validates that sub and role are present — a signed token with missing claims is still rejected. requireRole(...roles) is a middleware factory: requireRole("parent") returns middleware that 403s if the authenticated user's role isn't in the list. Failure responses are deliberately generic (401 INVALID_TOKEN) so an attacker can't distinguish "expired" from "bad signature" from "wrong role".

Frontend: AuthScreen.jsx handles both register and login. On register, the browser's IANA timezone is detected via Intl.DateTimeFormat().resolvedOptions().timeZone and sent with the payload. The JWT is written to localStorage before onAuthenticated fires, so a session is never shown before its token exists.

Session restore on refresh

The JWT is decoded client-side on mount (decodeJwtPayload) and used to repopulate session from localStorage. A restoring state gates the first render — the app shows a neutral loading screen instead of flashing the home screen to a user who is about to be signed in.

This is safe because the client never trusts the token for authorization; the server re-verifies on every API call. The client-side expiry check is a UX nicety — it avoids rendering a dashboard that will immediately 401. If the token is tampered with, the next API call fails and the user is signed out.

signOut clears localStorage before resetting state; otherwise the restore effect on the next page load would sign the user straight back in.

PART 3 — Mentor Profiles and Availability

Prompt:
Implement mentor profiles and availability. Mentors can edit their profile and IANA time zone and configure weekly availability in their own local time. Parents can browse available mentors, view profiles, and see trial-class slots in their own local time zone. Validate dates, times, and availability on the backend. Do not allow bookings in the past.

Response:
Mentor schema additions: bio, subjects (array of strings, at least one required), timezone (IANA name), availability (array of { dayOfWeek, startTime, endTime }), active (boolean).

Availability is stored as recurring weekly windows, not per-date slots. dayOfWeek is 1–7 (Mon–Sun), startTime and endTime are HH:MM local-time strings validated by a regex and interpreted in the mentor's timezone at slot-generation time.

Slot generation lives in utils/time.js → buildAvailableSlots({ date, timezone, windows, bookedSlots, now }). It walks each window in 60-minute increments, produces a Temporal.ZonedDateTime for each slot start in the mentor's zone, and filters out:

Slots in the past (compared against Temporal.Now.instant()).

Slots that overlap an existing active booking ([start, end) half-open interval check).

Slots on a date where the daily capacity is already exhausted.

Each generated slot carries startsAt and endsAt as Temporal instants, localStartTime (mentor-local HH:MM), and offset (the resolved UTC offset for that date, e.g. +05:30).

assertWithinAvailability(mentor, localBooking) validates on the write path that any incoming booking's local time falls inside a declared window for that weekday, that it starts on the 60-minute grid (offset % CLASS_DURATION_MINUTES === 0), and that the full class fits inside the window.

Endpoints:

GET /api/mentors — public. Search (search on name, bio, subjects), filter (subject), paginated. Only name bio subjects timezone availability active are returned; email and passwordHash are never exposed.

GET /api/mentors/:mentorId — public single-mentor read.

GET /api/mentors/:mentorId/availability?date=YYYY-MM-DD — public. Returns windows, bookedSlots, availableSlots, activeBookingCount, and remainingDailyBookings for the given mentor-local date.

PART 4 — Time-Zone Conversion and Daylight Saving Time

Prompt:
Handle timezone conversion and DST rigorously. Store booking instants in UTC. Store each user's IANA timezone separately. Interpret mentor availability in the mentor's zone and display slots in the parent's zone. Handle DST automatically. Handle ambiguous and nonexistent local times around DST transitions. Prevent double-booking across viewers in different zones. Do not hardcode offsets.

Test cases: India → New York (standard and daylight), India → London (standard and BST), dates just before and after DST transitions, an ambiguous fall-back time, and a nonexistent spring-forward time.

Response:
Instant and time-zone conversions are intended to go through Temporal.ZonedDateTime from @js-temporal/polyfill. Confirm this against the current source code before treating it as a repository-wide guarantee. The polyfill carries the IANA tz database, so America/New_York resolves to -05:00 (EST) in January and -04:00 (EDT) in July from the same input and the same zone name. No fixed offsets anywhere in the codebase.

Storage:

startsAt, endsAt → UTC Date.

timezone → the mentor's IANA zone at creation time.

localDate → mentor-local YYYY-MM-DD, denormalized so the daily-capacity query is cheap.

localStartTime → mentor-local HH:MM.

parseStartAt(value, timezone) accepts only ISO 8601 strings with Z or an explicit offset (OFFSET_DATE_TIME regex). Offset-less strings are rejected — accepting them would let a client send "2026-10-15T09:00" and have the server interpret it in its own local zone, silently shifting the booking.

DST handling in buildAvailableSlots:

Temporal.ZonedDateTime gives two disambiguation options — "earlier" and "later" — for wall-clock times that map to zero or two instants.

Spring-forward (nonexistent hour). For a candidate slot, we try both disambiguations and check that the resulting ZonedDateTime, when converted back to PlainDateTime, equals the original local time. On a spring-forward day, one wall-clock hour doesn't exist; the round-trip check fails for it and the slot is silently dropped. No invalid slot ever reaches the parent.

Fall-back (duplicated hour). Both disambiguations round-trip to the same wall-clock time. We keep the "earlier" instant and add it to a seenInstants set; the "later" instant is deduplicated by the set. The hour appears exactly once in the slot list.

Supported zones come from Intl.supportedValuesOf("timeZone") rather than a hardcoded array. This is deliberate — during development we hit a real bug where the browser sent Asia/Calcutta while the hardcoded list contained Asia/Kolkata. Node's Intl canonicalizes some India zones to Asia/Calcutta and some to Asia/Kolkata depending on the ICU build. Backing the list with Intl.supportedValuesOf makes the runtime's own list authoritative and eliminates the whole class of alias mismatch bugs.

Verified manually:

node -e "
const { Temporal } = require('@js-temporal/polyfill');
for (const d of ['2030-01-15T15:00:00Z','2030-07-15T15:00:00Z']) {
console.log(d, '->', Temporal.Instant.from(d).toZonedDateTimeISO('America/New_York').toString());
}
"

Output:

2030-01-15T15:00:00Z -> 2030-01-15T10:00:00-05:00[America/New_York]
2030-07-15T15:00:00Z -> 2030-07-15T11:00:00-04:00[America/New_York]

Same UTC instant, same zone name, different offsets — DST applied per date, no special-casing.

The development notes report end-to-end verification of the UI and email paths: booking a 09:00 slot with a New York mentor in January showed 19:30 India time; booking the same 09:00 slot in July showed 18:30 India time — a one-hour shift from the mentor's DST, not from any code change.

PART 5 — Email Notifications for Parents and Mentors

Prompt:
Send email notifications when a booking is created, cancelled, or changes status. Each email should include the recipient's name, the mentor's name, the booking time in the recipient's local time zone, the time zone or UTC offset, the booking ID, and a dummy demo-class link. Store the booking instant in UTC and convert separately for each recipient. Never display the mentor's local time as though it were the parent's.

Do not send before the database operation succeeds. Handle SMTP errors without losing the booking. Do not hardcode credentials. Do not log passwords.

Response:
Two emails per booking — one to the parent, one to the mentor — sent by notifyBookingCreated() in bookingService.js.

Ordering:

The booking transaction commits.

Parent.findById(parentId).lean() fetches the parent document.

notifyBookingCreated(...) is called without await, wrapped in .catch().

Sending after commit is intentional — a DB rollback should not produce a confirmation for a booking that doesn't exist. Not awaiting is also intentional — SMTP/API latency shouldn't delay the HTTP response to a parent who just booked.

Individual sends are wrapped in Promise.allSettled, not Promise.all. If the parent's email fails, the mentor's still goes out. Failures are logged but never propagate — the booking is the source of truth.

Timezone rendering: each recipient's email is formatted independently. The parent's email shows the parent's local time as the primary line (bold) and the mentor's local time as a muted secondary line. The mentor's email is the reverse. Neither recipient sees the other's time presented as their own.

Templates live in emails/bookingConfirmation.js. Table-based layout with inline styles (Outlook strips <style> blocks). Both text and html are generated. Every interpolation goes through escapeHtml.

The dummy class link is included twice: as a button ("Join class") and as a plain-text URL below it, for clients that strip styled buttons.

Transport, and why it changed:

The initial implementation used Nodemailer over Gmail SMTP. The recorded deployment attempts reportedly failed with ETIMEDOUT / ENETUNREACH on SMTP ports, so the implementation was changed to an HTTP email API. Verify the provider limitation and error logs in the actual deployment before presenting the cause as independently confirmed.

The fix was to switch the transport to Brevo's HTTP API on port 443, which is never blocked. lib/mailer.js now calls:

POST https://api.brevo.com/v3/smtp/email

with { sender, to, subject, textContent, htmlContent }. No SDK, no dependency — just fetch. The BREVO_API_KEY env var holds the API key; if it's unset, the mailer logs the would-be send and returns { skipped: true } without throwing, so the app runs locally with email disabled.

Brevo's sandbox requires the sender address to be verified under Senders, Domains & Dedicated IPs — a one-click confirmation email. Once verified, the account can send to any recipient on the free tier (300/day).

Verification recorded: both emails were reported to have arrived at their intended inboxes with dual-timezone rendering. Retain this claim only if you have actually confirmed receipt and can reproduce the test. The development notes report that the times were checked against the DST scenarios from Part 4 — a January booking rendered 19:30 India time for the parent and a July booking rendered 18:30. Reproduce this test with the actual mentor zone, booking instant, and recipient zone before treating it as verified.

PART 6 — Booking Logic and Daily Limit

Prompt:
Implement the trial-booking workflow. Parents browse mentors, view slots, select one, submit a request. Mentors view requests and can cancel. Rules: a mentor conducts at most two demo classes per mentor-local calendar day — not UTC date. Prevent overlapping bookings. Prevent duplicate bookings for the same slot. Do not allow bookings in the past. Revalidate availability on the backend. Handle simultaneous booking requests safely. Return a meaningful error if no mentor or slot is available.

Add automated tests for: first booking of the day, second booking, attempted third, overlapping slots, simultaneous requests, and no-available-mentor.

Response:
The daily cap is enforced by a DailyCapacity document per mentor per mentor-local date:

{
mentorId,
localDate: "YYYY-MM-DD", // mentor-local, not UTC
activeCount: Number, // min: 0, max: 2
}

Unique index on { mentorId, localDate } so there's exactly one counter per mentor per day.

The reservation is intended to be an atomic operation inside a session.withTransaction(). Confirm that the capacity document is created/initialized safely before this update; findOneAndUpdate() without upsert does not create a missing document.

const reservation = await DailyCapacity.findOneAndUpdate(
{
mentorId: mentor.\_id,
localDate: localBooking.date,
activeCount: { $lt: ACTIVE_BOOKING_LIMIT },
},
{ $inc: { activeCount: 1 } },
{ new: true, session, runValidators: true },
);
if (!reservation) throw new ApiError(409, "…", "DAILY_LIMIT_REACHED");

The { $lt: ACTIVE_BOOKING_LIMIT } guard is part of the update query, so checking and incrementing an existing counter is atomic. The service must also handle a missing counter document, transaction retries/write conflicts, and duplicate-key errors. The concurrency test should be run against the actual code to confirm the full flow, including first-time counter creation.

Overlap detection uses a half-open interval [startsAt, endsAt):

const overlap = await Booking.exists({
mentorId: mentor.\_id,
localDate: localBooking.date,
status: "active",
startsAt: { $lt: endsAt },
endsAt: { $gt: startsAt },
}).session(session);

Strict < / > means back-to-back bookings (10:00–11:00 and 11:00–12:00) don't collide. Cancelled bookings are excluded by status: "active".

Defense-in-depth — the Booking schema also has a partial unique index:

bookingSchema.index(
{ mentorId: 1, startsAt: 1 },
{ unique: true, partialFilterExpression: { status: "active" } },
);

Even if the service-layer overlap check had a bug, the database would reject two active bookings starting at the same instant. Cancelled bookings fall outside the partial index, so re-booking a freed slot is allowed.

Cancellation flips the booking to cancelled and decrements the counter in the same transaction, with a { activeCount: { $gt: 0 } } guard so the count can never go negative.

Errors surfaced to the client:

400 INVALID_MENTOR_ID

404 MENTOR_NOT_FOUND

400 PAST_BOOKING

400 UNAVAILABLE_TIME

409 DAILY_LIMIT_REACHED

409 TIME_SLOT_TAKEN

Tests described for src/tests/api.test.js use mongodb-memory-server as a single-node replica set (transactions require a replica set) and connect the Express app. Run these tests locally before claiming they pass. The intended concurrency case is:

const attempts = await Promise.all(
starts.map((startAt) =>
request("/api/bookings", {
method: "POST",
token: account.token,
body: { mentorId: mentor.id, startAt },
}),
),
);
const accepted = attempts.filter(({ response }) => response.status === 201);
const rejected = attempts.filter(({ response }) => response.status === 409);
assert.equal(accepted.length, 2);
assert.equal(rejected.length, 2);

Four parallel POSTs against a daily cap of 2 — exactly two succeed. That test is what proves the atomic guard works. A read-then-write would let all four through.

Additional tests cover cancellation releasing capacity, cross-user authorization (a mentor can't book; another parent can't cancel someone else's booking), and slot availability returning correct offsets.

One requirement clarification: the brief says "we assign an available mentor." I read that as: the parent picks which mentor they want to work with, then picks a slot from that mentor's calendar. This is the Booking.com / Calendly model rather than a matchmaking model. Documented here so the choice is explicit.

PART 7 — Dummy Demo-Class Link

Prompt:
Generate a dummy meeting URL for a confirmed booking. Store it with the booking record. Show it to authorized participants only. Include it in notification emails. Make it clear in the UI that the link is a placeholder and does not create a real video call.

Response:
Every booking carries a deterministic dummy URL derived from its bookingId:

https://meet.mentormatch.com/class/<bookingId>

The base is configurable via CLASS_BASE_URL; the default is a plausible-looking placeholder rather than example.com because the brief asks for a link that "will take them to a demo class." Including the bookingId in the URL makes it deterministic and traceable.

The link is intended to appear in:

The parent confirmation email (Join class button + raw URL below it).

The mentor notification email (same).

The booking confirmation modal in the UI.

The bookings list, on active bookings.

Everywhere it appears, the surrounding copy states plainly that this is a demo link — it does not start a real video conference. No real video-conferencing service is integrated, and the README does not claim otherwise.

Participant access is enforced server-side. GET /api/bookings filters by parentId or mentorId depending on the authenticated role, so a booking link is only reachable by the two people on it. A non-participant querying the same bookingId gets the standard 404 — the endpoint doesn't leak whether the booking exists.

PART 8 — Frontend UI and Responsive Design

Prompt:
Review and fix the frontend: API integration, input validation, error handling, responsive behavior, and timezone display. Show both parent-local and mentor-local times where useful. Do not claim a feature works unless it has been implemented and verified.

Response:
Two UI iterations shaped the final design.

Timezone display in the booking modal. The first version of each slot button showed the viewer's time on one line and the mentor's time as a greyed secondary line (6:30 PM / 9:00 AM mentor). This produced a technical-looking grid that no parent would actually read.

The revised version shows only the viewer's local time, formatted as <Weekday> <time> — e.g. Fri 6:30 PM or Sat 12:30 AM. The weekday prefix is the important part. The date picker walks the mentor's calendar, but slot times render in the viewer's zone. For a parent in India booking a New York mentor, the mentor's Saturday morning slots land on the parent's Friday evening. Without the day prefix, a parent would see "Saturday" in the picker and "6:30 PM" in the slot list with no way to reconcile the two.

formatters.js exposes both:

formatInstant(value, timezone) — full date and time for confirmations and the booking list.

formatSlotWithDay(value, timezone) — compact weekday + time for the slot grid.

Both take an IANA zone name, never a fixed offset. Both resolve the correct DST offset for the specific instant they're formatting.

Capacity counter copy. The original text "2 daily places left" read like a venue seat count. It measures the mentor's remaining trial capacity for that day, not the number of free windows. It was rewritten to "N slots left for this day" and hidden entirely when no slots are available — a counter showing "2 left" above "no available times" is self-contradictory.

Empty-state copy. The single message "No available times on this date" was replaced with a two-line state that distinguishes the two reasons a day can be empty:

The mentor doesn't work that day (the availability windows array is empty for that weekday).

The mentor works that day but the slots are taken (windows exist, no free slots).

That distinction prevents a misleading "try another week" suggestion when the mentor simply never works weekends.

Mobile topbar. On narrow screens the topbar was overflowing — the brand wordmark, theme toggle, "Sign in" button, and "Join MentorMatch" button all competed for width. Fixes:

Hide the "Mentors" nav anchor below 768px.

Shorten "Join MentorMatch" to "Join" and drop the arrow icon below 560px.

Shrink theme-toggle button padding below 400px.

Tested at 375px (iPhone SE width) — no wrap, no overflow.

Mobile hero. The Aisha Khan spotlight card inside the hero image was overlapping the hero copy on small screens. It's decorative — the mentor directory below does the real work — so the card is hidden below 768px, and the hero section is set to min-height: auto with reduced vertical padding. The image stays as a background band.

Verification recorded during development: the production build (npm run build) was reported to pass, mobile layouts were reported checked at 375px, 414px, and 768px, and the booking flow was reported exercised on the deployed environment. Re-run these checks against the current repository before submission.

PART 9 — Backend Integration and Final Audit

Prompt:
Audit the whole project before submission. Check: frontend/API integration, models, auth, input validation, booking conflict prevention, the two-per-day limit, timezone conversions, DST handling, email configuration, notification reliability, env vars and secrets, error handling, API response consistency, and responsive behavior. Run the tests and report actual results. Do not claim a feature works unless verified. Never print secrets.

Response:

Checks reported during development (re-run before submission)

Authentication. Register creates a hashed password; Parent and Mentor are separate models. JWT verified server-side on every request. Role guard returns 403 for the wrong role, 401 for a missing or invalid token.

Session restore. Refresh while signed in restores the dashboard from the JWT payload in localStorage without a server round-trip, gated by a restoring state so the home screen never flashes. Sign-out clears localStorage and all session state.

Booking capacity. The DailyCapacity counter with its atomic findOneAndUpdate enforces the two-per-mentor-per-local-day limit under concurrent load. Four parallel POSTs against a limit of 2 produce exactly two 201s and two 409 DAILY_LIMIT_REACHEDs. Cancellation releases capacity.

Overlap prevention. Half-open interval check in the service layer, plus a partial unique index at the database level on (mentorId, startsAt) for active bookings only.

Timezones and DST. Same 09:00 mentor slot booked for January and July 2027 rendered as 19:30 and 18:30 India time respectively — a one-hour difference from the mentor's DST shift, resolved automatically by Temporal.ZonedDateTime. No fixed offset arithmetic anywhere.

Email. Two emails per booking, sent after the transaction commits, using Brevo's HTTP API on port 443. Individual failures are isolated with Promise.allSettled and logged. Each recipient sees their own local time as the primary line. If BREVO_API_KEY is unset, the mailer logs the would-be send and returns without throwing.

Public surface. GET /api/mentors selects only name bio subjects timezone availability active — no email, no passwordHash. Verified against the response shape.

Test results (recorded; re-run before submission)

Suite

File

Result recorded in these notes

Integration (HTTP + MongoDB replica set)

src/tests/api.test.js

Reported passing; needs reproducible run

Unit (Temporal + slot arithmetic)

src/tests/time.test.js

Reported passing; needs reproducible run

The integration suite is described as covering registration, protected-route auth, concurrent booking under the daily cap, cancellation releasing capacity, cross-user authorization, public mentor listing field selection, and slot availability offsets. The first run may download a MongoDB binary for the in-memory replica set; confirm the current test setup and its network requirements before running it.

Known limitations and items to verify

Seeded demo emails: the notes say seeded addresses use the reserved .test domain and therefore are not real deliverable addresses. Use a controlled test inbox to verify email end-to-end; never send test messages to unintended recipients.

CORS configuration: the notes report open CORS (cors() with no options). Restrict allowed origins to the deployed frontend before production use.

Email provider limits: verify the current Brevo plan and sending limits in the provider account; do not rely on a fixed limit copied into this document.

Deployment availability: if the backend uses a free hosting tier, confirm its current sleep/wake behaviour and document the observed limitation in the README.

Mentor assignment is user-driven, not automatic. The brief says "we assign an available mentor." The implementation lets the parent pick a mentor, then a slot — closer to Calendly than to a matchmaking service. This interpretation is documented.

Deployment

Frontend: Vercel, VITE_API_BASE_URL pointing at the deployed backend.

Backend: Render.

Database: MongoDB Atlas.

Email: Brevo HTTP API (chosen after Render's SMTP block on ports 25/465/587 was confirmed to reject all Nodemailer sends regardless of recipient).

Add the actual repository and live-demo URLs here after verifying they are accessible. The README should contain the correct health-check endpoint and current setup instructions.

Pre-submission verification checklist

Before sending this document, verify each item against the current repository. Replace any claim that has not been reproduced with its actual status.

Confirm the candidate and institute details.

Include the original prompts and actual AI responses required by the assignment; this feature-grouped document is summarized, not a verbatim full chat export.

Run backend and frontend setup commands from a clean checkout.

Confirm MongoDB connection and health-check response.

Run the unit and integration test suites and update the results table with actual output.

Verify DST spring-forward and fall-back cases, including the policy for duplicated local times.

Verify the daily-capacity counter's first-booking initialization and concurrent booking behaviour.

Confirm the configured email provider, test inbox delivery, retry behaviour, and per-recipient local times.

Confirm the dummy link is clearly labelled and does not claim to provide a real video call.

Add and test the actual GitHub repository and live-demo URLs.

Ensure .env, API keys, passwords, tokens, and private connection strings are not committed or included in the transcript.

Closing note

The following items are described as implemented in the development notes. Verify each against the current repository and reproducible tests before claiming full assignment compliance:

Local times displayed to both parties — Temporal.ZonedDateTime on the server, Intl.DateTimeFormat on the client, both timezones in the emails.

DST handled — IANA zone names, not fixed offsets, with explicit disambiguation for spring-forward and fall-back.

Dummy demo-class link — deterministic per-booking URL, included in both emails and both UIs, labelled as a placeholder.

Two demo classes per mentor per day — atomic findOneAndUpdate capacity guard, verified by a concurrency test that fires four parallel requests.

Clear error state when no mentor is available — two empty states in the booking modal (mentor doesn't work that day / all slots taken), plus an empty state in the directory search.

Where an implementation choice departs from a literal reading of the brief—such as parent-selected mentors instead of automatic assignment, the chosen email provider, or client-side JWT decoding for session restore—explain the decision in the README. Ensure the README matches the code that is actually present.
One important design point: the date in the availability query is a mentor-local date, not a UTC date and not the parent's date. The date picker in the booking modal walks the mentor's working calendar (because the mentor's working hours define what slots exist), while the slot times inside are rendered in the parent's timezone. Those can disagree by a day at the boundary — which is why each slot button carries an explicit weekday prefix (see Part 8).
