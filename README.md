# Judge Queue

A judging queue and interview tracker for a robotics-style event. Teams request
a judge from their phone; judges work the queue; a colour-coded board shows the
whole floor at a glance.

**No database.** All data lives in one JSON file (`.data/state.json`). There is
nothing to sign up for and nothing to configure — clone, `npm install`,
`npm run dev`, and it works, pre-loaded with demo teams you can click around.

---

## Start it

```bash
npm install
npm run dev          # http://localhost:3000
```

That is the whole setup. **Never used a terminal before?** Follow
[RUNNING.md](RUNNING.md) instead — same thing, explained from scratch. Sign in at `/login` with `JA2026` to reach the Judge
Advisor console.

### Before anyone else can reach it

```bash
cp .env.example .env.local     # then edit the codes
```

| Variable | Dev default | What it is |
|---|---|---|
| `ADMIN_CODE` | `JA2026` | Judge Advisor. Full control. Keep it to yourself. |
| `QUEUER_CODE` | `DESK01` | Queue desk. Can only add teams to the queue. |
| `SESSION_SECRET` | insecure key | Signs the login cookie. `openssl rand -base64 32` |
| `DATA_FILE` | `.data/state.json` | Where the data lives. |
| `SEED_DEMO` | on | Set to `false` to start with an empty roster. |

**Those defaults are development-only and cannot be used in production.** A
production build refuses to sign anyone in with an unset code, and refuses to
start at all without a real `SESSION_SECRET` — a code printed in a README is not
an access code, and a known signing key would let anyone mint themselves a Judge
Advisor cookie. In development it warns on the console instead, so a fresh clone
still just runs.

Judge panel codes are **not** environment variables. Each panel gets its own,
generated in the admin console under **Panels** — so you can add a panel
mid-event without restarting anything.

---

## The one thing to know before you deploy

Teams and judges have to see each other's updates, so this needs **one
long-running Node process**. It is not a database, but it is still a shared
server.

| Where | Works? | |
|---|:---:|---|
| Your laptop at the venue | ✅ | `npm run build && npm start`, everyone joins your wifi |
| Railway / Render / Fly.io | ✅ | Node host with a persistent disk. Mount a volume and point `DATA_FILE` at it. |
| **Vercel / Netlify serverless** | ❌ | Each request can land on a different machine with its own empty disk. The board would disagree with itself. |

Running on a laptop is a genuinely good option for an event: no internet
dependency at all, everything over venue wifi. The tradeoff is that everyone
must be on that network, and the board dies if the laptop sleeps. Disable sleep.

To find your address for other devices:

```bash
npm run build && npm start
# then share http://<your-lan-ip>:3000  (macOS: ipconfig getifaddr en0)
```

### When you outgrow the file

`supabase/schema.sql` is the same data model as Postgres tables, kept for when
you want a real database. Every read and write goes through `src/lib/store.ts`
and nothing else — that file is the only thing that would need rewriting.

---

## Before the event

1. Sign in at `/login` with your `ADMIN_CODE`.
2. **Teams tab → Reset → Wipe everything.** This clears the demo roster. Do
   this first, or you will be judging the Quantum Quokkas.
3. **Panels tab** — add each judge group: name, room, judge names. Write down
   each panel's code and hand it to that group.
4. **Import tab** — paste your roster, one team per line:
   ```
   1234, Iron Hawks, Pit 12
   1235, Circuit Breakers, Pit 13
   ```
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

| | request a judge | advance status | write notes | manage teams & panels |
|---|:---:|:---:|:---:|:---:|
| **Team** (no login) | ✅ own team | — | — | — |
| **Queue desk** (`QUEUER_CODE`) | ✅ any team | — | — | — |
| **Judge** (panel code) | ✅ own panel | ✅ own panel | ✅ | — |
| **Judge Advisor** (`ADMIN_CODE`) | ✅ | ✅ any panel | ✅ | ✅ |

The queue desk can also **undo** an entry it just made, but only while the
request is still orange — once judges acknowledge it, it is out of their hands.
To make the role strictly create-only, delete the `queuer` branch in
`canCancel()` in [`src/lib/auth.ts`](src/lib/auth.ts).

Judges can only touch requests belonging to their own panel. Every one of these
rules is enforced server-side in the API routes, not just hidden in the UI.

---

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

With no database to enforce these, they are checked in `store.ts` instead. Node
runs one piece of JavaScript at a time and each check-then-write is synchronous,
so these really are atomic — two teams tapping the same slot in the same
millisecond cannot both get it. The second gets a readable error.

**Durability.** Writes are batched into one disk hit every 200ms, written to a
temp file and renamed over the real one so a crash mid-write cannot truncate
your data, and flushed on shutdown. If the file is ever unreadable, the app
keeps the bad copy as `state.json.corrupt-<timestamp>` and starts empty — empty
rather than demo data, so a real event never finds itself with invented teams.

**Back it up** by copying `.data/state.json`. That is the entire database.

---

## Development

```bash
npm test          # 20 tests: store invariants, slot maths, roster parsing
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
