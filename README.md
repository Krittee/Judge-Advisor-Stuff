# Judge Queue

A judging queue and interview tracker for a robotics-style event. Teams request
a judge from their phone; judges work the queue; a colour-coded board shows the
whole floor at a glance.

Built for ~120 teams across a dozen judge panels, but it runs fine with three.

---

## What you need to set up

Two free accounts, about fifteen minutes. Nothing to install locally unless you
want to develop.

### 1. Supabase (the database)

1. Create a free project at [supabase.com](https://supabase.com). Pick a region
   near your venue. Save the database password somewhere — you will not need it
   for this app, but losing it is annoying.
2. Open **SQL Editor → New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql),
   and run it.
3. Optional: run [`supabase/seed.sql`](supabase/seed.sql) too. That gives you
   3 panels and 24 fake teams so you can click around before your real roster
   exists. Clear it later with `truncate panels, teams cascade;`.
4. Go to **Project Settings → API** and copy two values:
   - the **Project URL**
   - the **`service_role`** key (under Project API keys — reveal it first)

> The `service_role` key bypasses all database rules. It is only ever used
> server-side in this app. Never put it in a variable starting with
> `NEXT_PUBLIC_`, and never paste it into a browser console.

### 2. Vercel (the hosting)

1. Push this repo to GitHub, then **Add New → Project** at
   [vercel.com](https://vercel.com) and import it. Framework detection handles
   the rest — no build settings to change.
2. Before the first deploy, add these under **Settings → Environment Variables**:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | your Project URL from step 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | your `service_role` key from step 1 |
   | `SESSION_SECRET` | any long random string — `openssl rand -base64 32` |
   | `ADMIN_CODE` | the code **you** will use. Keep it private. |
   | `QUEUER_CODE` | the code the queue desk will use |

3. Deploy. You will get a URL like `judge-queue.vercel.app`.

### 3. Decide your codes

- `ADMIN_CODE` — you, the Judge Advisor. Full control.
- `QUEUER_CODE` — the queue desk. Can only add teams to the queue.
- **Judge panel codes** are not env vars. Each panel gets its own, created and
  shown in the admin console under **Panels**. Hand each judge group their code
  on a card.

Codes are case-insensitive and read aloud across a noisy room, so avoid `0`/`O`
and `1`/`I`. Auto-generated panel codes already skip those.

### 4. Before the event

1. Sign in at `/login` with your `ADMIN_CODE`.
2. **Panels tab** — add each judge group: name, room, judge names.
3. **Import tab** — paste your roster, one team per line:
   ```
   1234, Iron Hawks, Pit 12
   1235, Circuit Breakers, Pit 13
   ```
   Pasting straight from a spreadsheet works (tabs are handled), a header row is
   skipped, and quoted names with commas survive. Tick **spread across panels**
   to deal teams out evenly.
4. **Teams tab** — fix any assignment by hand.
5. Optional: give each panel a slot grid (Panels → Booking slots). Set the count
   to `0` for walk-up queue only.

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

Judges can only touch requests belonging to their own panel. That check is in
[`src/app/api/requests/[id]/route.ts`](src/app/api/requests/%5Bid%5D/route.ts),
enforced server-side — not just hidden in the UI.

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
labels and the ordering all live in one table.

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

## How it stays in sync

Every screen polls `/api/state` — 4 seconds for consoles, 6 for the board — and
an unchanged board returns a `304` with no payload. Tabs that are not visible
stop polling entirely.

Polling rather than websockets is deliberate: venue wifi drops constantly and a
poll reconnects by itself with no special handling. If you expect a lot of
simultaneous viewers, raise the interval in the `useAppState(...)` call at the
top of each page.

Two database rules do the load-bearing work, so a double-tap cannot corrupt the
board no matter what the UI does:

- one live request per team
- one team per panel slot

Both are partial unique indexes in `schema.sql`. The API turns their violation
into a readable message rather than an error.

---

## Running locally

```bash
npm install
cp .env.example .env.local     # then fill it in
npm run dev                    # http://localhost:3000
```

```bash
npm test          # logic tests — slot maths, roster parsing, board ranking
npm run typecheck
npm run build
```

The app degrades honestly without Supabase configured: pages render, and
`/api/state` returns `503 not_configured` instead of crashing.

---

## Event-day notes

- **A team is stuck orange and nobody is going.** Admin → Floor → reassign them
  to another panel from the dropdown.
- **Someone queued the wrong team.** Queue desk can undo it while it is orange;
  after that, admin cancels it from the Floor tab.
- **A judge lost their code.** Admin → Panels shows every code.
- **You need to know what happened.** Admin → Activity logs every status change
  with who did it.
- **Adding a panel mid-event** works without redeploying — judge codes live in
  the database, not in environment variables.

Everything is stored in Supabase, so closing a laptop or losing a phone loses
nothing.
