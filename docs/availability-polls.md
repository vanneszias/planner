# Availability polls ("find an evening")

A small feature next to events: an organizer sends a link, everyone paints when
they're free on a grid, and a time is chosen. Built for recurring meetups such
as prayer evenings, where the hard part is overlapping schedules, not seats or
workshops. It shares accounts, organizations, the UI kit, i18n and D1 with
events, but has its own tables and screens.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | **Painted grid.** The organizer sets a date range (at most 31 days), daily hours and how long the meeting lasts. The grid has 30-minute cells.                                                                                                                                       |
| P2  | **Free / if needed.** Respondents mark cells as free or "if needed". Ranking: most people who can come, then most who are truly free, then the earliest. A start time only counts if the whole meeting fits in one day's hours.                                                      |
| P3  | **Organizer picks the decision mode per poll.** _Manual_: the organizer confirms one of the best times. _Auto_: at a deadline the best time is confirmed if at least `min_attendees` (default 1) can come; otherwise the poll becomes "needs decision" and the organizer is emailed. |
| P4  | **Optional sign-in.** Signed-in people answer as their account (one answer per poll). Guests give a name and an optional email; they get a signed cookie and a private edit link (token stored as a SHA-256 hash only).                                                              |
| P5  | **Names visible per poll.** A toggle decides whether respondents see each other's names or only counts. Organizers always see names.                                                                                                                                                 |
| P6  | **Polls belong to an organization** and reuse event permissions: `event:create` to create, `event:update` to confirm, reopen, cancel and edit settings or groups, `event:delete` to delete.                                                                                          |
| P7  | **Groups are organization members.** A group is a saved set of members; creating a poll for a group emails each of them the link. The link still works for anyone else.                                                                                                              |
| P8  | **Location is set by the organizer**, not voted on.                                                                                                                                                                                                                                  |

## Data

`poll`, `poll_respondent`, `poll_group`, `poll_group_member`
(`packages/db/src/schema/polls.ts`). Availability is stored per respondent as
JSON lists of cell start instants (UTC ms): `{ free: [...], ifNeeded: [...] }`.
Saving drops marks that aren't on the grid, so changing nothing about the grid
keeps answers valid. The grid shape can't be edited after creation.

The share code is stored as is: it's meant for a group chat, not a personal
credential. Guest edit tokens are hashed.

Grid layout, ranking and the `.ics` file are pure functions in
`@app/domain/poll-grid`, shared by the server and the browser.

## Lifecycle

```
open ──confirm (organizer)────────────► confirmed ──reopen──► open
  │                                         ▲
  └─auto deadline─┬─ enough people ─────────┘
                  └─ not enough ──► needs_decision ──confirm──► confirmed
any ──cancel──► cancelled ──reopen──► open
```

- The `jobs` cron (`*/15 * * * *`) resolves auto polls past their deadline. The
  public page also resolves a due poll when it loads, so nobody waits up to 15
  minutes. Both use a status-guarded update, so a poll is resolved once.
- Reopening an auto poll whose deadline has passed switches it to manual, or the
  next cron run would close it again.
- Outcome emails are claimed in `email_delivery` (key includes the confirmed
  time), so retries and double clicks never send twice, and a new time after a
  reopen is announced again.

## Live updates

The poll page listens on `/api/live/poll/<code>`, forwarded to the same Durable
Object class events use (`EventCoordinator`), addressed by poll id. Poll ids are
UUIDv7 like event ids, so they never collide. Messages are only
`{ "type": "poll" }`; browsers then refetch through the loader. No names or
availability go over the socket.

## Privacy and retention

- Polls, with every answer, are deleted 90 days after the grid's last day
  (daily cron, `deleteExpiredPolls`).
- Respondent emails go only to outcome mails; they're never shown in the UI.
- Guest answers are rate limited per IP and poll (the `ranking` limiter).
- The organization slugs `m` and `polls` are reserved, since `/m/<code>` and
  `/polls` share the shape of public event URLs.

## Not done yet

- Turnstile on guest answers (rate limiting only for now).
- Recurring polls ("every month, same group") beyond starting a new poll from a group.
- Proposing more than one evening per poll.
