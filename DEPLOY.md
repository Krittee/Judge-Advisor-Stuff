# Put it on the web — no terminal, no downloads

Everything below happens in your browser. You will not type a single command.

**Time:** about 15 minutes. **Cost:** free.

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

> If you cannot find Storage on the import screen, deploy first (Step 5), then
> open your project → **Storage** tab → **Create Database** → Neon. Then
> **Deployments** → the ⋯ menu on the newest one → **Redeploy**.

---

## Step 4 — Set your three codes

On the same page, open **Environment Variables**. Add these three, clicking
**Add** after each:

| Name | Value |
|---|---|
| `ADMIN_CODE` | A code only you know. This is full control. |
| `QUEUER_CODE` | A code for whoever works the queue desk. |
| `SESSION_SECRET` | A long random string — see below. |

**For `SESSION_SECRET`,** just mash your keyboard for 40+ characters. It does
not need to be memorable and you will never type it again. Something like
`k3j4h5g6f7d8s9a0q1w2e3r4t5y6u7i8o9p0zxcvb` is fine.

Do **not** use `JA2026` or `DESK01` — those are printed in this guide, so
everyone can read them. The app refuses to accept them once deployed anyway.

---

## Step 5 — Deploy

Click **Deploy**.

Wait about two minutes. When it finishes you get a **Congratulations** screen
and a link like `judge-queue-abc123.vercel.app`. Click it.

You should see the Judge Queue page. **That address is your app** — it works
from any phone, on any network, anywhere in the world.

---

## Step 6 — Check the database really connected

This is worth thirty seconds now rather than a surprise on the day.

1. Go to `your-address.vercel.app/login`
2. Sign in with the `ADMIN_CODE` you chose in Step 4
3. Open the **Teams** tab and scroll to the bottom

You should see:

> Storing into **Postgres at ep-something.neon.tech**

If instead it says *"This is running on a local file"* with an orange warning,
the database did not connect. Go back to Step 3, then redeploy: **Deployments**
→ ⋯ on the newest → **Redeploy**.

---

## Step 7 — Set up your event

All in the browser, at `your-address.vercel.app/admin`:

1. **Panels tab** — click **Add preset panels**, then fill in each group's
   judge names. Each panel has a **code** and a **division**; write the codes
   down and hand each one to that group.
2. **Import tab** — paste your team list, one per line:
   ```
   1234, Iron Hawks, Pit 12
   9882K, Kilo Kestrels, Pit 13
   ```
   Or drop an Excel (`.xlsx`) or CSV file straight in — it is read on your own
   computer and never uploaded. Pick which **division** it goes into above the
   box. Running two divisions? Import each one separately.
   Team numbers can include letters, like `9882K`.
   Copy straight out of Excel or Google Sheets. Tick **spread across panels**
   to share teams out evenly.
3. **Teams tab** — check it, fix anything by hand.

A deployed app starts empty — no demo teams to clear.

---

## What to hand out on the day

| Who | Where to send them |
|---|---|
| Teams | `your-address.vercel.app` |
| Judges | `your-address.vercel.app/login` + their panel code |
| Queue desk | `your-address.vercel.app/login` + your `QUEUER_CODE` |
| The TV | `your-address.vercel.app/board`, then press Fullscreen |

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
`ADMIN_CODE` was probably never set, or has a stray space. Check
**Settings → Environment Variables**, fix it, redeploy.

**The build failed**
Open the failed deployment and read the red lines at the bottom. Nine times out
of ten it is a missing environment variable from Step 4.

**Everything is slow on the very first visit of the day**
Normal. Free servers idle when unused and take a few seconds to wake. Open the
board a minute before you need it.

---

## Free tier limits, honestly

For a 120-team event over one or two days, you will not come close to any of
them. Neon's free database and Vercel's free hosting are both far more generous
than this app needs. There is no card required and nothing to cancel.

---

## Prefer to run it on your own laptop instead?

That works too, needs no accounts, and has no internet dependency — but it does
need a terminal. See **[RUNNING.md](RUNNING.md)**.
