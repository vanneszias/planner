# Design system direction

Foundation: shadcn/ui on Tailwind CSS v4, English and Dutch (D13), WCAG 2.2 AA,
rebrandable (`packages/brand`). This doc sets the direction; tokens and
components get built in M0 and M1.

## The world we're designing for

A youth weekend or camp, not a conference. The things people actually hold
there: a printed programme booklet, a timetable taped to the hall door, coloured
dot stickers on name tags, a festival wristband, a felt-tip schedule on a
whiteboard. Most of the time it's someone aged 12 to 25 on a mid-range phone,
outdoors or in a noisy hall, checking where to go next.

So the interface should feel like **a well-made printed programme that happens to be
live**: calm ink-on-paper chrome, with colour reserved for the one thing
participants scan for, which is _which workshop is this_.

## Signature: workshop markers and the day strip

**Workshop markers.** Every workshop gets a marker: a colour plus a shape, like
the coloured dot stickers camps use to sort groups. The marker appears wherever
the workshop does: its card, the schedule grid, the booking list, the itinerary,
the printed attendance list, the check-in screen.

- Eight felt-tip colours × eight shapes (circle, triangle, square, diamond,
  star, hexagon, plus, half-moon). Workshop _n_ gets colour `n mod 8` and shape
  `(n + floor(n / 8)) mod 8`, so 64 workshops get distinct pairs before any repeat.
- **Shapes carry the meaning; colour reinforces it.** Colour-blind participants
  and black-and-white printouts still work.
- Every glyph has a 1.5 px ink outline, like a sticker. That outline is what meets
  the 3:1 non-text contrast requirement (WCAG 1.4.11), so fill colours are free
  to be cheerful.
- Organizers can change a workshop's marker, but never pick a free-form colour.

**The day strip.** A participant's itinerary is a single vertical strip per day,
like a festival wristband or a ticket roll: one segment per session, separated by
a perforation line, each led by its marker, start time in mono, workshop title,
room. Gaps between sessions show as plain "free time" segments, so the strip
reads as the whole day. It is the screen participants open most, the thing that
gets printed, and the moment allocation results arrive.

**The risk we're taking:** the chrome stays almost colourless and the brand
colour is used sparingly, while eight saturated marker colours do the visual
work. Most event tools lead with one brand colour; here, a busy programme page
looks like a sheet of stickers. If it tests as too childish with 16-to-25-year-olds,
the fix is to deepen the marker set, not to drop the system.

## Colour

All ratios measured against the tokens below (WCAG 2.x formula).

### Base

| Token     | Hex       | Use                                                               | Contrast                                       |
| --------- | --------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| `ink`     | `#1C1E33` | Text, glyph outlines, primary icons                               | 15.3:1 on `paper`                              |
| `paper`   | `#F6F7F9` | App background                                                    | (base)                                         |
| `card`    | `#FFFFFF` | Cards, sheets, inputs                                             | ink 16.4:1                                     |
| `muted`   | `#565B70` | Secondary text, metadata                                          | 6.3:1 on `paper`                               |
| `edge`    | `#7C8296` | Input borders, focus-adjacent outlines                            | 3.6:1 on `paper` (meets 3:1 for UI boundaries) |
| `line`    | `#D5D9E2` | Decorative dividers only, never the sole boundary of a control    | 1.3:1 (decorative)                             |
| `kelp`    | `#0E6B5C` | Default platform brand colour: primary buttons, links, focus ring | 6.0:1 on `paper`, white text on it 6.4:1       |
| `danger`  | `#B42A1B` | Errors, destructive actions                                       | 6.0:1 on `paper`                               |
| `success` | `#1D7536` | Confirmation states                                               | 5.4:1 on `paper`                               |

`kelp` is the _placeholder_ platform brand colour, picked because deep green-teal
reads outdoorsy and calm and doesn't compete with the markers. A rebrand
replaces it in `packages/brand`.

Status backgrounds use light tints with ink text (ink on `#E8F3F1` 14.4:1,
on `#FBE9E7` 14.0:1, on `#FFF4D6` 14.9:1), never coloured text on coloured fill.

### Markers

| Marker    | Fill      | Shape (default order) |
| --------- | --------- | --------------------- |
| Tomato    | `#D63B2F` | circle                |
| Sun       | `#D99A00` | triangle              |
| Grass     | `#2F8A41` | square                |
| Sea       | `#1F7FB8` | diamond               |
| Grape     | `#7A4FC9` | star                  |
| Bubblegum | `#CF3F86` | hexagon               |
| Sky       | `#2A95C2` | plus                  |
| Moss      | `#6B7A2E` | half-moon             |

Rules:

- Markers never hold text. Labels sit beside the glyph in ink.
- Marker colours are never used for status (no "red = full").
- In the schedule grid, a session block gets a 4 px marker-coloured left edge
  plus the glyph; the block itself stays `card` white.

### Event branding (organizer)

Organizers can set a logo and one accent colour per event (MVP scope). The accent:

- applies only on that event's public pages: header band and primary buttons;
- is checked on save: if white text on it falls below 4.5:1, we darken it until
  it passes and show the organizer the adjusted colour;
- never replaces markers, status colours or the focus ring.

## Typography

| Role    | Face                                 | Why                                                                                                                           | Use                                                                                    |
| ------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Display | **Unbounded** (OFL)                  | Wide and rounded, the feel of a hand-lettered festival poster; youthful without being childish                                | Event name, day headings, the big "next up" time. Never in buttons, forms or body text |
| Body    | **Inter** (OFL)                      | Tuned for screens, with tabular figures; the `cv05` (tailed l) and `cv08` (serifed I) alternates are on, so Il1 stay distinct | Everything else, including times and counts (`tabular-nums`)                           |
| Utility | **Atkinson Hyperlegible Mono** (OFL) | Braille Institute design; its slashed zero keeps 0 and O apart where it matters most                                          | Participant codes, URLs                                                                |

- **Self-host all fonts** as Worker static assets. No Google Fonts CDN: it sends
  visitor IPs to a third party, which a German court (Munich, 2022) found to
  breach GDPR.
- **Dutch runs about 30% longer** and has long compounds
  (_inschrijvingsformulier_). Display headings are capped at `clamp(1.75rem, 6vw, 2.75rem)`
  on mobile, and use `hyphens: auto` with the correct `lang` attribute.

Type scale (rem, 1.25 ratio, body 1rem / 16px minimum on mobile):

| Token     | Size           | Face / weight               |
| --------- | -------------- | --------------------------- |
| `display` | 2.75 (clamped) | Unbounded 600               |
| `h1`      | 1.95           | Unbounded 500               |
| `h2`      | 1.56           | Inter 700                   |
| `h3`      | 1.25           | Inter 700                   |
| `body`    | 1.0            | Inter 400, line-height 1.55 |
| `small`   | 0.875          | Inter 400                   |
| `time`    | 1.0 / 1.25     | Inter 700, tabular-nums     |

## Shape, space, depth

- **Radius:** 12 px cards, 10 px inputs and buttons, full-round for markers and
  chips. Soft, but not bubbly.
- **Spacing:** Tailwind's 4 px scale; mobile page gutter 16 px; cards 16 to 20 px padding.
- **Depth:** no shadows on cards at rest. Separation comes from `card` white on
  `paper`. One shadow level for things that float (sheets, popovers, the sticky
  action bar).
- **Perforation:** the day strip's segment divider is a dashed 1 px `line` with
  two small half-circle notches at the edges. It's the only decorative device in
  the system.

## Key layouts

### Participant: event page (mobile)

```
┌──────────────────────────────┐
│ [logo]   Zomerkamp 2027      │  ← display face, event accent band
│ 12–13 July · De Kluis, Gent  │
├──────────────────────────────┤
│ Programme  My day  Info      │  ← three tabs, the only navigation
├──────────────────────────────┤
│ Saturday                     │
│ ◆ Screen printing   10:00    │
│   Atelier · 4 places left    │
│ ● Climbing          10:00    │
│   Hall B · Full · Waitlist   │
│ ▲ Podcast lab       11:30    │
│ …                            │
├──────────────────────────────┤
│  [ Book 2 sessions ]         │  ← sticky action bar
└──────────────────────────────┘
```

### Participant: ranking (mobile)

```
┌──────────────────────────────┐
│ Rank your favourites         │
│ Pick up to 5. We'll fit as   │
│ many top picks as we can.    │
├──────────────────────────────┤
│ 1  ◆ Screen printing   [↑][↓]│
│ 2  ● Climbing          [↑][↓]│
│ 3  ▲ Podcast lab       [↑][↓]│
│ ──── not ranked ──────────── │
│    ★ Theatre sport      [+]  │
│    ⬢ Bike repair        [+]  │
├──────────────────────────────┤
│  [ Save my ranking ]         │
└──────────────────────────────┘
```

Move up and down buttons are the primary interaction (WCAG 2.5.7, dragging
alternative); drag is an enhancement on top. Each move announces "Climbing
moved to position 2 of 3" through a polite live region.

### Participant: day strip

```
┌──────────────────────────────┐
│ Saturday 12 July             │
│ ┌──────────────────────────┐ │
│ │ 10:00 ◆ Screen printing  │ │
│ │       Atelier, 1st floor │ │
│ ├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤ │  ← perforation
│ │ 11:30   Free time        │ │
│ ├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤ │
│ │ 13:30 ● Climbing         │ │
│ │       Hall B · Changed   │ │  ← change highlighted, with reason on tap
│ └──────────────────────────┘ │
│ [ Add to calendar ] [ Print ]│
└──────────────────────────────┘
```

### Organizer

Desktop-first with a collapsible left sidebar (Events, Workshops, Schedule,
Participants, Allocation, Check-in, Settings). Everything works on a phone, and
check-in is designed phone-first.

- **Schedule:** list editor (TanStack Table) as the primary editor; a read-only
  day grid (rooms × time) beside it, with marker edges. Every edit possible
  without the grid.
- **Allocation review:** metrics row (share getting first choice, rank spread,
  empty slots) above a filterable table of people and results, with a side sheet
  per person showing their ranking, result and explanation trace.
- **Check-in:** full-screen camera view, the last scan's result as a big
  marker-plus-name confirmation, manual search below.

## Components

shadcn/ui primitives used as-is: Button, Input, Select, Checkbox, Radio Group,
Dialog, Sheet, Popover, Tabs, Toast (Sonner), Table, Form helpers with TanStack
Form, Command (search).

Product components to build, in `packages/ui`:

| Component           | Notes                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `Marker`            | Glyph with ink outline; `aria-hidden` (the workshop name is the label)                     |
| `WorkshopCard`      | Marker, title, short description, age groups, sessions                                     |
| `SessionRow`        | Time (mono), workshop, room, seat state, action                                            |
| `SeatState`         | Text first: "4 places left", "Full, join waitlist", "You're 3rd in line". Never only a bar |
| `RankList`          | Up and down buttons, live-region announcements, optional drag                              |
| `DayStrip`          | Itinerary per day; printable                                                               |
| `ScheduleGrid`      | Read-only rooms × time; virtualised for big events with TanStack Virtual                   |
| `AllocationMetrics` | Numbers with plain-language labels                                                         |
| `ScanResult`        | Check-in confirmation: large marker, name, session, status                                 |
| `EmptyState`        | Says what to do next, with one action                                                      |

## Accessibility (WCAG 2.2 AA)

- **Targets:** 44 × 44 px minimum for anything a participant taps (above the
  24 px AA minimum, 2.5.8).
- **Focus:** 3 px `kelp` ring with 2 px offset; sticky bars never cover the
  focused element (2.4.11), handled with `scroll-padding`.
- **No dragging required** (2.5.7): ranking and scheduling both have button
  alternatives.
- **Live updates:** seat counts change silently; only the session a participant
  is acting on announces changes ("This session just filled up"). No live region
  re-reading a whole list.
- **Authentication** (3.3.8): magic links and passkeys need no memory test;
  Turnstile stays non-interactive.
- **Language:** UI `lang` from the user's locale; organizer content gets the
  event's content language (`event.default_locale`), so screen readers
  pronounce Dutch workshop titles correctly in the English UI.
- **Motion:** `prefers-reduced-motion` turns all motion into instant changes.
- **Print:** day strips and attendance lists print in black and white; shapes
  keep markers distinguishable.

## Motion

One orchestrated moment: **when allocation results are published**, the
participant's day strip fills in segment by segment, each session stamping in
(short scale and settle, 120 ms apart). It marks the moment the product exists
for. Everything else is quiet: 150 ms fades for sheets and toasts, a brief tick
when a seat count changes.

## Voice

Plain, warm, direct, second person. Sentence case. Short. No exclamation marks
in system messages, no apologies, never vague about what happened.

| Moment                    | English                                                                                 | Dutch                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Primary action, booking   | Book this session                                                                       | Reserveer deze sessie                                                                     |
| Ranking intro             | Pick up to 5. We'll fit in as many of your top picks as we can.                         | Kies er maximaal 5. We plannen zoveel mogelijk van je favorieten in.                      |
| Session filled mid-choice | This session filled up while you were choosing. Pick another time or join the waitlist. | Deze sessie raakte vol terwijl je koos. Kies een ander moment of zet je op de wachtlijst. |
| Waitlist                  | You're 3rd in line. We'll email you if a place opens up.                                | Je staat 3e op de wachtlijst. We mailen je als er een plaats vrijkomt.                    |
| Organizer empty state     | No workshops yet. Add the first one, and you can plan sessions after that.              | Nog geen workshops. Voeg de eerste toe, daarna plan je de sessies.                        |
| Publish                   | Publish results → toast "Results published. 214 participants will get an email."        | Resultaten publiceren → "Resultaten gepubliceerd. 214 deelnemers krijgen een mail."       |

An action keeps its name through the whole flow: "Publish results" produces
"Results published", never "Allocation saved".

Copy lives in i18n message files from day one; Dutch strings are written by a
native speaker, not machine-translated, before the pilot.

## Tokens in shadcn/ui and Tailwind v4

shadcn/ui reads semantic CSS variables (`--background`, `--foreground`,
`--primary`, `--border`, `--ring`, …). We map them once:

| shadcn variable       | Our token      |
| --------------------- | -------------- |
| `--background`        | `paper`        |
| `--foreground`        | `ink`          |
| `--card`              | `card`         |
| `--muted-foreground`  | `muted`        |
| `--border`, `--input` | `edge`         |
| `--primary`, `--ring` | `kelp` (brand) |
| `--destructive`       | `danger`       |

Marker colours live as their own variables (`--marker-tomato` …) exposed to
Tailwind through `@theme`. `packages/brand` overrides only brand values (primary,
logo, fonts if wanted); event pages override `--primary` at the page root with the
validated event accent.

## Dark mode

Not in the MVP. The variable mapping above makes it a token exercise later,
but markers and the day strip need their own dark tuning, and the main use
(daytime events, printed lists) doesn't call for it yet.

## Revisions after review

- **Display face:** first pick was Bricolage Grotesque; swapped to Unbounded
  because Bricolage is now everywhere in startup sites. Unbounded is tied to
  posters and festival lettering.
- **Background:** started on a warm off-white; moved to cool `paper` `#F6F7F9`
  because warm cream with a serif is the default look of generated design.
- **Markers:** first palette failed 3:1 for Sun and Sky against `paper`. Instead
  of muddying them, every glyph got an ink outline, which carries the contrast.
- **Borders:** `line` alone (1.3:1) can't outline inputs; added `edge` at 3.6:1.
