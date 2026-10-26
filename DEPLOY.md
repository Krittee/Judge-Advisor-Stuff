# Put it on the web — no terminal, no downloads

Everything below happens in your browser. You will not type a single command.

**Time:** about 15 minutes. **Cost:** free to set up and try. For a real
event, read [Free tier limits](#free-tier-limits-honestly) first — the database
plan matters on the day.

At the end you will have a permanent web address like
`judge-queue.vercel.app` that anyone can open from any phone, anywhere — no
wifi juggling, no laptop that must stay awake.

---

## What you are signing up for

Two free accounts. Both let you sign in with your GitHub account, so there are
no new passwords to remember.

| Service | What it does | Cost |
|---|---|---|
| **Vercel** | Runs the app and gives it a web address | Free |
| **Neon** | Stores your teams, panels and requests | Free |

You need a database because the web version runs on many small servers that
start and stop constantly, and none of them keeps a hard drive. The database is
the shared memory they all read from. **You will never see any SQL** — the app
builds its own tables the first time it runs.

---

## Step 1 — Get the code into your own GitHub

If the code is already in your GitHub account, skip to Step 2.

1. Go to the repository page on GitHub
2. Click **Fork** (top right)
3. Click **Create fork**

You now have your own copy.

---

## Step 2 — Create the app on Vercel

1. Go to **[vercel.com](https://vercel.com)** and click **Sign Up**
2. Choose **Continue with GitHub** and allow access
3. On your dashboard, click **Add New…** → **Project**
4. Find `Judge-Advisor-Stuff` in the list and click **Import**
5. **Do not click Deploy yet.** Leave this page open and go to Step 3.

Vercel will have detected Next.js by itself. There is nothing to change in the
build settings.

---

## Step 3 — Add the database

Still on that import page:

1. Scroll to **Storage** (or open the **Storage** tab if you already deployed)
2. Click **Create** or **Connect Database**
3. Choose **Neon** (listed as Serverless Postgres)
4. Accept the free plan and click **Create**

Vercel connects it and quietly sets `DATABASE_URL` for you. That is the only
database setting the app needs, and you never have to look at it.

> If you cannot find Storage on the import screen, deploy first (Step 6), then
> open your project → **Storage** tab → **Create Database** → Neon. Then
> **Deployments** → the ⋯ menu on the newest one → **Redeploy**.

**Using Supabase instead of Neon?** Skip the Storage step. In the Supabase
dashboard open **Connect → Transaction pooler** (port 6543), copy the
`postgresql://…pooler.supabase.com:6543/postgres` string, fill in your
database password, and add it as `DATABASE_URL` in **Environment Variables**
(Step 4). The app creates its own tables on first connect.

**Keep previews off your live database.** Vercel builds a *preview* of every
pull request, and a preview uses whatever `DATABASE_URL` is set for the
**Preview** environment. If that is your live database, opening a preview
changes it and everything you click there shows up on the real board. In
**Settings → Environment Variables**, give `DATABASE_URL` one row for
**Production** (your live database) and a separate row for **Preview** pointing
at a spare one (a second free Neon or Supabase project). The values are hidden
once saved, so when in doubt, overwrite the Preview row.

---

## Step 4 — Set your access codes

On the same page, open **Environment Variables**. Add `ADMIN_CODE`,
`QUEUER_CODE`, and `SESSION_SECRET`, clicking **Add** after each. To give more
Judge Advisors their own access, add up to three optional administrator codes
as well:

| Name | Value |
|---|---|
| `ADMIN_CODE` | The first Judge Advisor's code. This is full control. |
| `ADMIN_CODE_2` | Optional second Judge Advisor code. |
| `ADMIN_CODE_3` | Optional third Judge Advisor code. |
| `ADMIN_CODE_4` | Optional fourth Judge Advisor code. |
| `QUEUER_CODE` | A code for whoever works the queue desk. |
| `REFEREE_CODE` | A code for the referees, who flag what they see on the field. |
| `HEAD_REFEREE_CODE` | A code for the head referee, who also sets the program and fields for the event. |
| `SESSION_SECRET` | A long random string — see below. |

**For `SESSION_SECRET`,** just mash your keyboard for 40+ characters. It does
not need to be memorable and you will never type it again. Something like
`k3j4h5g6f7d8s9a0q1w2e3r4t5y6u7i8o9p0zxcvb` is fine.

Give each Judge Advisor a different code, and do **not** use `JA2026`,
`DESK01`, `REF001` or `HREF01` — those are printed in this repository, so
everyone can read them. Once deployed the app refuses them, and that role simply
cannot sign in. Keep `HEAD_REFEREE_CODE` different from `REFEREE_CODE`.

Tick **Production** and **Preview** for each code and for `SESSION_SECRET`: a
setting saved for Production only never reaches a preview, and nobody can sign
in there.

---

## Step 5 — Put the app next to its database

Vercel runs the app in Washington, D.C. unless told otherwise. If your database
is somewhere else, every tap crosses an ocean: with the database in Singapore
that is about a second per request instead of about 0.2.

1. Find your database's region: Supabase → **Project Settings → General →
   Region** (Neon shows it on the project dashboard).
2. In Vercel: **Settings → Functions → Function Region** → pick the same place.
   For Supabase or Neon in Southeast Asia (Singapore, `ap-southeast-1`) that is
   **Singapore – `sin1`**. Only one region on the free plan.
3. **Save.** It applies from the next deployment.

---

## Step 6 — Deploy

Click **Deploy**.

Wait about two minutes. When it finishes you get a **Congratulations** screen
and a link like `judge-queue-abc123.vercel.app`. Click it.

You should see the Judge Queue page. **That address is your app** — it works
from any phone, on any network, anywhere in the world.

---

## Step 7 — Check the database really connected

This is worth thirty seconds now rather than a surprise on the day.

1. Go to `your-address.vercel.app/admin/login`
2. Sign in with any Judge Advisor code you configured in Step 4
3. Open the **Teams** tab and scroll to the bottom

You should see:

> Storing into **Postgres at ep-something.neon.tech**

If instead it says *"This is running on a local file"* with an orange warning,
the database did not connect. Go back to Step 3, then redeploy: **Deployments**
→ ⋯ on the newest → **Redeploy**.

While signed in, `your-address.vercel.app/api/health` shows the same thing in
one line: which database it is storing into, and how many teams and panels it
holds.

---

## Step 8 — Set up your event

All in the browser, at `your-address.vercel.app/admin`:

1. **Panels tab** — add judges with **New judge**, then put each on a panel.
   **Add preset panels** creates the panels listed in `config/event.json`, or
   add them one by one. Each panel has a **code** and a **division**; write the
   codes down and hand each one to that group. Removing or moving a judge off a
   panel rotates that panel's code; give its remaining judges the new code.
   **Edit** next to *Booking slots* turns on bookable times for that panel.
2. **Conflicts tab** — record each judge's conflicts *before* panels are
   settled. A panel inherits its judges' conflicts.
3. **Import tab** — paste your team list, one per line:
   ```
   1234, Iron Hawks, A1, Elementary School
   9882K, Kilo Kestrels, A2, Middle School
   ```
   That is number, name, pit, division. The pit is a letter and a number (it
   places the team on the floor plan); a blank division means the first one.
   Or drop an Excel (`.xlsx`) or CSV file straight in — it is read on your own
   computer and never uploaded. Team numbers can include letters, like `9882K`.
   Tick **spread across panels evenly** to share teams out. Re-importing
   updates teams and never duplicates them.
4. **Teams tab** — check it, fix anything by hand.
5. **On the day, the head referee signs in once** and chooses the program
   (VIQRC or V5RC) and the number of fields. Until then ordinary referees see
   a waiting screen.

A deployed app starts empty — no demo teams to clear.

---

## What to hand out on the day

| Who | Where to send them |
|---|---|
| Teams | `your-address.vercel.app/team` (type the team number) |
| Judges | `your-address.vercel.app/judge/login` + their panel code |
| Queue desk | `your-address.vercel.app/queue/login` + your `QUEUER_CODE` |
| Referees | `your-address.vercel.app/referee/login` + your `REFEREE_CODE` |
| Head referee | `your-address.vercel.app/referee/login` + your `HEAD_REFEREE_CODE` |
| Judge Advisors | `your-address.vercel.app/admin/login` + their `ADMIN_CODE…` |
| The TV | `your-address.vercel.app/board`, then press Fullscreen |

`your-address.vercel.app` itself is a "Who are you?" page with a door for each
role, so the plain address works for everyone. The old `/login` still works.

Make the team address short and readable — Vercel lets you rename the project
under **Settings → Domains** so it can be something like
`ourevent-judging.vercel.app`.

---

## Changing a code later

**Settings → Environment Variables** → edit the value → **Save**. Then
**Deployments** → ⋯ on the newest → **Redeploy**. Changes only take effect
after that redeploy.

---

## If something goes wrong

**"This is running on a local file" warning in the admin console**
The database is not connected. Step 3, then redeploy.

**Your code is not accepted**
Environment variables only apply to deployments made *after* they were saved.
Redeploy: **Deployments** → ⋯ → **Redeploy**.

**"That code was not recognised" for everyone**
Their `ADMIN_CODE`, `ADMIN_CODE_2`, `ADMIN_CODE_3`, or `ADMIN_CODE_4` was
probably never set, or has a stray space. Check
**Settings → Environment Variables**, fix it, redeploy.

**The build failed**
Open the failed deployment and read the red lines at the bottom. Nine times out
of ten it is a missing environment variable from Step 4.

**Every tap takes about a second**
The app is running far from its database. Step 5, then redeploy.

**Everything is slow on the very first visit of the day**
Normal. Free servers idle when unused and take a few seconds to wake. Open the
board a minute before you need it.

**A preview shows your real teams**
The Preview environment is using your live database. See *Keep previews off
your live database* in Step 3.

---

## Free tier limits, honestly

**The data is tiny; the traffic is not.** A 130-team event is a few megabytes,
far inside any free database. What adds up is *egress* — data the database
sends out. Every open screen asks for the whole event every 4–6 seconds, and
each ask reads every team, request and flag from the database, even when
nothing changed (the `304` saves the phone a download, not the database a
read).

A rough guide, measured from real record sizes (130 teams, about 4 referee
flags per team, 15 staff screens, 2 boards, 20 team phones on screen):

| | Estimate |
|---|---|
| One full read, averaged over the event | about 210 KB |
| Reads per second | about 9 |
| Database egress | about 6–7 GB per hour, about 100 GB for a two-day event |
| Supabase free plan | 5 GB per month — used up in the first hour |
| Supabase Pro ($25/month) | 250 GB per month — covers it |

So for a real event, **put the database on a paid plan for that month** (you
can drop back afterwards). Supabase Pro also stops the project pausing after a
week without visits — a free project left alone before the event can be asleep
on the morning — and keeps daily backups. Supabase → **Usage** shows what a
past event really used; trust that over this table.

Vercel's free plan is fine for the app itself.

---

## Prefer to run it on your own laptop instead?

That works too, needs no accounts, and has no internet dependency — but it does
need a terminal. See **[RUNNING.md](RUNNING.md)**.
