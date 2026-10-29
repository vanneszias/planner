# Participant and organizer journeys

Screen-by-screen flows for the MVP. Visual language from
[design-system.md](design-system.md); rules from [decisions.md](decisions.md).
Copy is English here; every string ships in Dutch too.

## Event states drive what participants see

| Event state                               | Booking mode participants see                     | Ranking mode participants see           |
| ----------------------------------------- | ------------------------------------------------- | --------------------------------------- |
| `draft`                                   | Nothing (page 404s for non-organizers)            | Nothing                                 |
| `published`, before `opens_at`            | Programme, "Booking opens Sat 3 May, 10:00"       | Programme, "Ranking opens …"            |
| `published`, window open                  | Programme with seats, booking                     | Programme, ranking                      |
| `published`, window closed, not allocated | Their bookings (changes per cut-off, D22)         | "Your ranking is in. Results come by …" |
| `published`, allocation published         | n/a                                               | Their day strip                         |
| `closed` (event over)                     | Itinerary read-only                               | Itinerary read-only                     |
| after retention                           | "This event's participant data has been deleted." | same                                    |

Organizers always see a banner on the public page saying which state it's in.

## Participant journeys

Targets: a new participant can register and book, or register and rank, **in
under 2 minutes on a phone**, without creating a password.

### P1. Adult, booking mode: from link to booked

1. **Event page** (`/{org}/{event}`, from a link, poster QR or message).
   Event band, three tabs (Programme · My day · Info). Programme lists sessions
   per day with markers, times, rooms and seat state ("4 places left").
   _If not registered:_ tapping a session opens its detail with
   "Book this session".
2. **Register sheet** (opens on first "Book"). Name, email, age group (if the
   event uses them), consent checkbox linking the privacy notice. Turnstile runs
   invisibly. Button: "Book this session". _Booking happens in the same step_; no
   email round trip first (C1). The confirmation email includes "Not you?
   Cancel this registration".
3. **Booked.** Toast "Booked: Screen printing, Sat 10:00". The session row now
   shows "Booked". The sticky bar shows "2 of 3 sessions booked". A confirmation
   email goes out with their private link.
4. **Book more.** Sessions that overlap a booked one show "Overlaps
   Screen printing" and can't be booked; full ones offer "Join the waitlist".
5. **My day** tab shows the day strip as soon as there's one booking.

Edge cases:
- **Session fills while the sheet is open:** "This session filled up while you
  were choosing. Pick another time or join the waitlist." The rest of the form is kept.
- **Email already registered for this event:** "This email is already registered
  for Zomerkamp 2027. We've sent a sign-in link." (Never reveals details on screen.)
- **Booking window closed:** the button is replaced by "Booking closed on …".

### P2. Adult or guardian, ranking mode: rank, wait, get results

1. **Event page**, Programme tab. Workshops (not sessions) with markers;
   session times shown or hidden per D7.
2. **Rank sheet** ("Rank your favourites"). Tap "+" to add a workshop to the
   ranked list; reorder with ↑ ↓ (drag optional). Counter "3 of 5 picked".
   "Save" is enabled once the event's minimum is reached (C4, default sessions to attend + 1).
3. **Register** (if new): same fields as P1. Button "Save my ranking".
4. **Saved.** "Your ranking is saved. Results come by Friday 9 May." They can
   change it until ranking closes; the confirmation email links back.
5. **Results arrive** (email "Your Zomerkamp programme is ready"). Opening it
   plays the day strip fill-in, the one orchestrated motion moment. If enabled
   (D9), each session has "Why this session?", e.g. "Climbing was full by your
   turn in round 1. You got your 2nd choice, Podcast lab."
6. **Unfilled slot** (D10 = leave empty): the strip shows "Free time, your
   organizer may still place you". Never phrased as failure.

**Guardians** registering several people: after the first, "Register someone
else" reuses their email and prefills nothing else. Each person gets their own
private link; the guardian's account lists all of them.

### P3. Minor via private link or QR

Organizer-registered (D2, D16). The minor has no account and may have no email.

1. **Code card** (printed by the organizer, or forwarded by a guardian): QR
   code, short code `K7Q2-XA`, the event name, the minor's first name.
2. **Scan or open link** → lands directly in _their_ view: "Hi Noor" header,
   then the same booking (P1 steps 3 to 5) or ranking (P2 steps 2, 4 to 6) flow,
   with no register step.
3. **Typing the code instead:** event page → "I have a code" → enter
   `K7Q2-XA` (case-insensitive, dash optional).
4. **Keeping access:** "Save this page to your home screen" hint once. The
   same QR is their check-in pass on the day.

Organizer fallback: if a minor never uses their code, organizers enter or import
choices for them (D16), and the minor's view shows those choices.

Security: tokens are long and random behind the short code; codes are
rate-limited per IP and per event; organizers can regenerate a lost or leaked code
(old one stops working immediately).

### P4. Returning: "where's my programme?"

Ways back, in order of how often they'll be used:
1. **Private link** from any email.
2. **Home-screen shortcut** (PWA install).
3. **Event page → "Find my programme"** → email field → magic link. Same
   neutral message whether or not the email is registered.
4. **Signed-in account** (adults, guardians): "My events" list.
5. **Code** (minors), as in P3.

### P5. Something changes

| Change                       | Participant sees                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| Waitlist promotion           | Email and day strip badge: "You got a place: Climbing, Sat 13:30."                                  |
| Session time or room changed | Email, strip segment badge "Moved from 10:00" or "Now in Hall B".                                   |
| Session cancelled            | Email: "Climbing on Saturday is cancelled." Slot becomes free time until the organizer places them. |
| Organizer moved them         | Email and badge: "Your organizer moved you to Podcast lab."                                         |

Badges stay until the participant opens the strip, then fade to a quiet "changed" dot.

### P6. Event day

1. **My day** opens on the current day with "Next up" (time in display face, room).
2. At the door, the facilitator scans their QR (O8). Participant sees nothing; no
   action needed.
3. No phone? Facilitator searches their name.

## Organizer journeys

### O1. Sign up and first event

1. **Sign up** (Better Auth): email + magic link, passkey, password, or Google.
   Turnstile on sign-up. Creates a personal organization named after them,
   renamable (and its slug, D19).
2. **"Create your first event"** guided flow, one question per step, all
   skippable with defaults:
   1. Name, dates, place (timezone derived from place, editable).
   2. "How should people choose workshops?" Two big cards: _They book sessions
      themselves (first come, first served)_ / _They rank favourites and we
      plan it for them_. Short honest description of each.
   3. "How many sessions does each person attend?" (default 3)
   4. Age groups? (optional)
3. Lands on the **event overview**: a checklist "Add workshops → Schedule
   sessions → Register participants → Publish". Each item links to its screen and
   ticks itself off.

### O2. Build the programme

1. **Workshops**: list with "Add workshop". Form: title, description, image,
   facilitator name, category, age groups. Marker auto-assigned, changeable.
2. **Sessions**: per workshop, "Add session" (time, room, capacity), or
   "Repeat this workshop" → pick several start times at once. Default capacity
   copies from the workshop's last session.
3. **Schedule view**: list editor (TanStack Table, sortable by time, room,
   workshop) beside the read-only day grid. Conflicts flagged inline: same room
   double-booked, session outside event dates.
4. **Settings** (collapsed "More options"): times while ranking, rank limit,
   explanations, empty slots, change cut-off, window dates, retention. Most
   organizers never open it.

### O3. Invite collaborators

Settings → People → "Invite" (email + role: Owner, Editor, Viewer, D14). Invite
email with a sign-in link. Role descriptions in plain words: "Editors can change
events and run allocations. Viewers can see participants and export lists."

### O4. Register minors and distribute codes

1. **Participants → Add** one at a time (name, age group), or **Import CSV**:
   upload, map columns, preview with errors per row ("Row 14: age group
   'kids' doesn't exist"), confirm.
2. **Code cards**: "Print code cards" → A4 sheet, 8 cards per page, each with
   QR, short code, first name, event name. Or "Email codes to guardians" if a
   guardian email column was imported (C2).
3. Optional: **enter choices** for someone (ranking or bookings) from their
   participant detail.

### O5. Open and monitor

1. **Publish** the event page (checklist complete, or "Publish anyway"). Shows
   the public URL and a QR code to download for posters.
2. **Overview** while open: registrations count, seats left per session (live),
   rankings submitted, sessions near capacity. Participant table with filters
   (age group, has booked / has ranked, waitlisted).

### O6. Run the allocation (ranking mode)

1. **Close ranking** (or it closes at `closes_at`). Banner: "Ranking closed.
   142 of 150 participants ranked."
2. **Run allocation**: pick strategy (Take turns / Early birds first, D3), each
   with one-line explanation; "Run draft".
3. **Review draft**: metrics in plain words ("118 people got their 1st choice",
   "6 people have an empty slot"). Table of people with their results; filter
   "empty slots", "got no top-3 choice". Side sheet per person: ranking,
   result, explanation trace.
4. **Adjust**: move a person (only sessions that fit are offered), lock
   placements, re-run (creates a new draft; locked placements stay).
5. **Publish results**: confirmation shows counts and the email that will go out.
   Toast: "Results published. 150 participants will get an email." A second
   publish later shows "12 people will move" before confirming.

### O7. Changes after publishing

- **Edit a session's time or room**: on save, "37 people are booked. They'll
  get an email about the change." Overlaps the change creates are listed
  for manual resolution.
- **Cancel a session**: lists affected participants with suggested moves to
  free sessions they ranked or that fit (C3). Organizer confirms per
  person or in bulk.
- **Move someone**: from their detail page; notification is a checkbox, on by default.

### O8. Event day check-in

1. **Check-in** (phone-first). Pick session (defaults to the one starting
   nearest now) → camera opens.
2. **Scan** → large result: marker, name, "Checked in" (or "Not booked for this
   session · Check in anyway?"). Next scan ready immediately.
3. **Search** fallback by name. **Counter** "23 of 30 here".
4. **No signal:** printed attendance list from O5's export (D17).

### O9. After the event

- Event moves to `closed` automatically the day after `ends_on`.
- **Export**: attendance per session, participant list, CSV.
- Overview shows "Participant data will be anonymised on 10 October" (D6, D20),
  with "Anonymise now".
- **Duplicate event** for next year is Phase 2.

## Resolved choices

|     | Choice                                   | Decision                                                                                  |
| --- | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| C1  | Book immediately or confirm email first? | Book immediately; the confirmation email has "Not you? Cancel this registration" (D23)    |
| C2  | Email codes to guardians?                | Yes, alongside printed cards; guardian email stored per minor, cleared at retention (D24) |
| C3  | Moves after a cancelled session?         | System suggests, organizer confirms per person or in bulk (D25)                           |
| C4  | Minimum ranked workshops?                | Per-event setting, default sessions to attend + 1 (D26)                                   |
