# Judge Queue

A judging queue and interview tracker for a robotics-style event. Teams request
a judge from their phone; judges work the queue; a colour-coded board shows the
whole floor at a glance.

## Two ways to run it

| | What you do | Needs a terminal | Needs accounts |
|---|---|:---:|:---:|
| **[Put it on the web](DEPLOY.md)** | Click through Vercel + a free database | No | Two, both free |
| **[Run it on a laptop](RUNNING.md)** | `npm install && npm run dev` | Yes | None |

The web version gives you a permanent address any phone can reach from
anywhere. The laptop version needs no accounts and no internet, but everyone
must be on your wifi and the laptop must stay awake.

**Storage follows from that choice and needs no thought:** set `DATABASE_URL`
and it uses Postgres, creating its own tables on first run; leave it unset and
it keeps everything in one JSON file (`.data/state.json`). Nothing outside
`src/lib/db/` knows the difference.

---

## Start it

```bash
npm install
npm run dev          # http://localhost:3000
```

That is the whole setup — it boots with demo data so there is something to look
at. Sign in at `/login` with `JA2026` to reach the Judge Advisor console.

**Never used a terminal before?** [RUNNING.md](RUNNING.md) explains this from
scratch, or [DEPLOY.md](DEPLOY.md) skips the terminal entirely.

### Before anyone else can reach it

```bash
cp .env.example .env.local     # then edit the codes
```

| Variable | Dev default | What it is |
|---|---|---|
| `ADMIN_CODE` | `JA2026` | Judge Advisor. Full control. Keep it to yourself. |
| `QUEUER_CODE` | `DESK01` | Queue desk. Can only add teams to the queue. |
| `SESSION_SECRET` | insecure key | Signs the login cookie. `openssl rand -base64 32` |
| `DATABASE_URL` | unset | Set it to use Postgres; unset uses the JSON file. |
| `DATA_FILE` | `.data/state.json` | Where the file store keeps its data. |
| `SEED_DEMO` | on in dev, off in production | `true`/`false` to force it either way. |

**Those defaults are development-only and cannot be used in production.** A
production build refuses to sign anyone in with an unset code, refuses the codes
published in these docs even when you set them deliberately, and refuses to
start at all without a real `SESSION_SECRET` — a code printed in a README is not
an access code, and a known signing key would let anyone mint themselves a Judge
Advisor cookie. Production also never seeds demo teams. In development it warns
on the console instead, so a fresh clone still just runs.

Judge panel codes are **not** environment variables. Each panel gets its own,
generated in the admin console under **Panels** — so you can add a panel
mid-event without restarting anything.

---

## Where it can run

| Where | Storage | Works |
|---|---|---|
| Vercel / Netlify serverless | Postgres via `DATABASE_URL` | ✅ [DEPLOY.md](DEPLOY.md) |
| Railway / Render / Fly.io | Either | ✅ |
| Your laptop at the venue | JSON file | ✅ [RUNNING.md](RUNNING.md) |
| Serverless with **no** database | — | ❌ every request may hit a different machine with an empty disk |

The file store needs one long-running process with a disk; Postgres does not
care how many instances there are. The admin console's Teams tab shows which
one is live, and warns if a deployment is running on a file.

### Swapping storage

`src/lib/db/` holds both backends behind one interface: `file.ts`, `postgres.ts`
and an `index.ts` that picks between them on `DATABASE_URL`. Nothing else in the
app knows which is in use.

---

## Before the event

1. Sign in at `/login` with your `ADMIN_CODE`.
2. **Teams tab → Reset → Wipe everything.** This clears the demo roster. Do
   this first, or you will be judging the Quantum Quokkas.
3. **Panels tab** — add each judge group: name, room, judge names. Write down
   each panel's code and hand it to that group.
4. **Import tab** — drop in a `.xlsx`, `.csv` or `.tsv` file, or paste your roster
   one team per line:
   ```
   1234, Iron Hawks, Pit 12
   9882K, Kilo Kestrels, Pit 13
   ```
   Team numbers may contain letters (`9882K`), and are matched
   case-insensitively so a team typing `9882k` still finds itself. Pits read
   best as a letter and a number (`A1`) — that is what places a team on the
   board's pit floor plan.

   Spreadsheets are read in your browser — the file is never uploaded anywhere.
   Old `.xls` files are not readable; re-save them as `.xlsx` or CSV. Whatever
   you load lands in the box first, so you can check it before importing.
   Pasting straight from a spreadsheet works (tabs are handled), a header row is
   skipped, and quoted names with commas survive. Tick **spread across panels**
   to deal teams out evenly.
5. **Teams tab** — fix any assignment by hand.
6. Optional: give each panel a slot grid (Panels → Booking slots). Set the count
   to `0` for walk-up queue only.

Between a practice run and the real thing, **Reset → Clear today's requests**
empties the queue but keeps your roster and panels.

---

## Who can do what

Everything below is enforced in the API routes. The UI hides what a role cannot
do, but hiding is not the control — a judge posting straight at the API gets the
same refusal.

| | request | advance status | cancel | judging notes | manage teams & panels |
|---|:---:|:---:|:---:|:---:|:---:|
| **Team** (no login) | own team | — | own request | — | — |
| **Queue desk** (`QUEUER_CODE`) | any team | — | un-seen only | — | — |
| **Judge** (panel code) | own panel | **own panel** | own panel | **own panel** | — |
| **Judge Advisor** (`ADMIN_CODE`) | any | any | any | any | ✅ |

**"Own panel" is the load-bearing part.** A judge may only advance, cancel, read
or write against teams assigned to the panel whose code they typed. Another
panel's team returns `403` on every one of those, and a judge's `/api/state` is
scoped to their own division — they do not receive the other division's teams at
all. A team nobody is assigned to is Judge Advisor territory only.

Judges *do* drive the colour flow for their own teams — that is what makes the
board change without you touching it. If you would rather they could not, one
line in `canAdvance()` in [`src/lib/auth.ts`](src/lib/auth.ts) turns it off.

The queue desk can also **undo** an entry it just made, but only while the
request is still orange. Once judges acknowledge it, it is out of their hands.

---

## Booking: now, or later

Both routes are offered side by side, on the team's own page and at the queue
desk:

- **Interview now** — joins the walk-up queue and goes straight to orange.
- **Book a time** — claims one of the panel's slots and waits at *scheduled*
  until its turn.

**Conflicts are shown, not hidden.** The slot grid lists every slot with its
state — free, taken (with the team number holding it), already gone, or yours —
so a full schedule reads differently from a panel that runs no slots at all.
Alongside it, the panel's current load: how many teams are waiting and how long
the longest has been there.

Two clashes get handled rather than merely reported:

- **Another team already holds that slot.** Refused by the database, not just
  the UI, so two people booking at the same instant cannot both win.
- **This team already holds a later slot but is ready now.** The button becomes
  *"Interview now instead (frees 2:15 PM)"* — it releases the booking, then
  queues them. Without that the slot would sit there unused and the schedule
  would lie about how full it is.

A team already in the walk-up queue simply cannot be added twice.

---

## Scoring

Two rubrics, each a tab on a team's card in the judge and Judge Advisor
consoles: **Engineering Notebook** and **Team Interview**. Topics only — judges
keep the printed rubric with its listen-fors in front of them, and this is only
where the points land. Each tap saves immediately.

Two ways to undo: tap a chosen value again to clear **that one criterion**, or
use **Clear score** to wipe **one whole rubric** and start it over — behind a
two-step confirm, and it never touches the other rubric. Clearing removes the
record entirely rather than zeroing it, so a cleared team reads as *not scored*
and ranks below a team genuinely scored zero.

Points sum per rubric, then across both, and the combined total falls into a
colour band shown on the **Scores** tab: ranked highest first, with unscored
teams at the bottom and no colour at all — not-yet-judged is not the same as
scoring badly.

**Judges and the Judge Advisor only.** A judge sees and scores their own panel's
teams; every other role gets `403`, matching the rubric's own line that judging
materials do not leave the judging room.

Both are taken exactly from the official v2.0 sheets:

| Rubric | Criteria | Scale | Total |
|---|---|---|---|
| Engineering Notebook | 16, in 5 sections | 1–4 · Beginning → Exemplary | **64** |
| Team Interview | 6, in 2 sections | 0–2 · Not Yet Heard → Heard, with Specifics | **12** |

A team can earn **76** in all. The two scales differ, so each rubric carries its
own and the API enforces it per rubric — `0` is refused on the notebook, whose
scale starts at 1, and accepted on the interview.

### Editing the rubrics

[`config/rubrics.json`](config/rubrics.json) holds both, plus the colour bands.
Criterion ids are derived from their text, so reordering the file is safe.
Renaming a criterion detaches its existing scores, which is the honest outcome:
it is no longer the same thing being measured.

Tests assert each rubric still matches its printed sheet — criteria counts,
scale wording, and every section total — so an accidental edit fails the suite
rather than surfacing on event day.

---

## The big board

Two tabs, both meant for a TV in the judges' room. **Fullscreen** is in the
corner.

**By panel** — every judge panel with its teams, coloured by interview status.

**Pit floor** — the pits seen from above. Two things read at once, so they use
different channels rather than competing: each **division** is its own
colour-bordered block, and **interview status** fills the pit tile itself, in
the same colours as the queue board. A thin rail down each tile carries the team
type.

The plan draws itself from the pit codes — no floor plan to lay out. A pit is a
**letter and a number**, `A1`, `B7`, `C12`: the letter is the row, the number the
position along it. `a1`, `A01`, `A 1` and `Pit A1` all mean the same pit.

Within a division, a blank cell is a genuinely empty pit. Where another division
occupies that stretch of the row, the space is left silent rather than drawn as
free — the rows still line up, but the board never says a pit is empty when
somebody is standing in it. Teams with no pit, or one that is not a
letter-and-number, are listed underneath rather than dropped.

---

## Team types

Every team is one of two kinds — **Developing** or **Fully Developed** — set from
a dropdown in Admin → Teams, and colour-coded everywhere a team appears: the big
board, the judge console, the queue desk, the rankings and the team's own page.
The colour carries the distinction and the label backs it up, so it still reads
for anyone who cannot separate amber from violet.

Set it per team, for a whole import at once, or per row with a fifth CSV column
(which accepts either the label or the id). Admin → Teams filters by type and
counts each one.

Rename the labels or change the colours in
[`config/event.json`](config/event.json) under `teamCategories`. The first one
listed is what a team gets until someone says otherwise; keep the ids stable
once teams are assigned.

---

## Divisions

Two divisions can run at once, and they are a **hard wall**:

- Every team and every panel belongs to exactly one division.
- Auto-assign never crosses it. A division with no panels leaves its teams
  unassigned rather than handing them to the wrong judges.
- Reassigning a team to a panel in the other division is refused — even for you.
- A judge only ever sees their own division.

**Moving a panel mid-event** is supported: change its division in Admin →
Panels. Its current teams stay in the division they compete in and become
unassigned, so another panel on that side can pick them up. The console warns
you before it does this.

To change a team's division, use the Division column in Admin → Teams. That
unassigns it from its panel for the same reason.

### Starting the panel list over

Admin → Panels → **Delete all panels** clears every panel in one go, behind a
two-step confirm. It takes the panels only: your teams and their interview
history survive, released to no panel, ready to be re-assigned once you have
built the list you want. Every judge code stops working the moment you do it.

### Preset panels

[`config/event.json`](config/event.json) holds your divisions and a starting set
of judge panels with their codes. It seeds the roster the **first time** the app
runs with no panels — after that the admin console owns them, and editing the
file again will not overwrite what is there. **Admin → Panels → Add preset
panels** creates anything from the file that is missing, and never touches a
panel you already have.

Change the codes in that file before your event: they are public in this repo.

## The colours

| Colour | Status | Meaning |
|---|---|---|
| ⬜ Slate | Scheduled | Booked a slot, not started |
| 🟠 **Orange** | Requesting | Team is waiting on a judge — **pulses** |
| 🔵 Blue | On the way | Judges acknowledged, heading over |
| 🟣 Purple | Interviewing | Interview in progress |
| 🟢 Green | Complete | Done |
| ⚫ Grey | Cancelled | Withdrawn or no-show |

Orange is the only status that animates. If something is orange, it needs a
human. Change any of this in [`src/lib/status.ts`](src/lib/status.ts) — colours,
labels and ordering all live in one table.

---

## The screens

| URL | Who | What |
|---|---|---|
| `/` | teams | Enter team number |
| `/team/1234` | teams | Status, request a judge, book a slot |
| `/board` | everyone | Big-screen board. Has a fullscreen button. |
| `/login` | staff | One code box for all three staff roles |
| `/judge` | judges | Your panel's queue, oldest orange first |
| `/queue` | queue desk | Add a team to the queue, see who's waiting |
| `/admin` | you | Floor · Teams · Panels · Import · Activity |

Put `/board` on the TV in the judges' room and press Fullscreen.

There is no mobile app to install — it is a website that works on a phone. If
you want it to feel like an app, teams can use **Add to Home Screen**.

---

## How it holds together

**Syncing.** Every screen polls `/api/state` — 4 seconds for consoles, 6 for the
board — and an unchanged board returns a `304` with no payload. Tabs that are
not visible stop polling entirely. Polling rather than websockets is deliberate:
venue wifi drops and a poll reconnects by itself.

**Two rules cannot be broken**, no matter what the UI does:

- one live request per team
- one team per panel slot

On Postgres these are partial unique indexes, so they hold across any number of
server instances. On the file store they are synchronous checks, which is enough
because Node runs one piece of JavaScript at a time. Either way, two teams
tapping the same slot in the same millisecond cannot both get it — the second
gets a readable error, not a corrupted board.

**Durability.** Writes are batched into one disk hit every 200ms, written to a
temp file and renamed over the real one so a crash mid-write cannot truncate
your data, and flushed on shutdown. If the file is ever unreadable, the app
keeps the bad copy as `state.json.corrupt-<timestamp>` and starts empty — empty
rather than demo data, so a real event never finds itself with invented teams.

**Back it up** by copying `.data/state.json`. That is the entire database.

---

## Development

```bash
npm run check     # diagnose why it will not start, in plain language
npm test          # 40 tests: permissions, division wall, store invariants
npm run typecheck
npm run build
```

Four runtime dependencies: `next`, `react`, `react-dom`, `jose`.

---

## Event-day notes

- **A team is stuck orange and nobody is going.** Admin → Floor → reassign them
  to another panel from the dropdown.
- **Someone queued the wrong team.** Queue desk can undo it while it is orange;
  after that, admin cancels it from the Floor tab.
- **A judge lost their code.** Admin → Panels shows every code.
- **You need to know what happened.** Admin → Activity logs every status change
  with who did it.
- **The server restarted.** Nothing is lost — it reloads from the file.
