# How to run this

Written for someone who has never used a terminal. Follow it top to bottom.

> **Would you rather not use a terminal at all?** [DEPLOY.md](DEPLOY.md) puts
> the app on the web entirely through your browser — no downloads, no commands,
> and a permanent address any phone can reach from anywhere. Come back here if
> you would prefer to run it on your own laptop instead.

You will do this **four times total**: once now to try it, once to set up your
event, once for a practice run, once on the day. It gets faster each time.

---

## Step 1 — Install Node.js (once, ever)

Node.js is the program that runs this app. You install it once and never think
about it again.

1. Go to **[nodejs.org](https://nodejs.org)**
2. Click the big green button that says **LTS** (it will have a number like
   22.x.x — any number **18 or higher** is fine)
3. Open the downloaded file and click Next / Continue until it finishes

That's it. Nothing to configure.

---

## Step 2 — Open a terminal

A terminal is a window where you type commands instead of clicking.

- **Windows:** press the Start button, type `powershell`, press Enter
- **Mac:** press `Cmd + Space`, type `terminal`, press Enter

A window opens with a blinking cursor. This is normal. It is waiting for you.

**Check Node installed properly.** Type this and press Enter:

```
node --version
```

You should see something like `v22.22.2`. If you see "command not found",
close the terminal, open a new one, and try again. If it still fails, redo
Step 1.

---

## Step 3 — Get the code onto your computer

1. Go to the repository page on GitHub
2. Click the green **Code** button
3. Click **Download ZIP**
4. Find the ZIP in your Downloads folder and **unzip it** (double-click on Mac,
   right-click → Extract All on Windows)

You now have a folder. On Windows it might be
`C:\Users\You\Downloads\Judge-Advisor-Stuff`. On Mac,
`/Users/You/Downloads/Judge-Advisor-Stuff`.

**Now tell the terminal to go into that folder.** Type `cd` followed by a
space, then **drag the folder from your file explorer onto the terminal
window** and let go. It fills in the path for you. Press Enter.

```
cd /Users/You/Downloads/Judge-Advisor-Stuff
```

To check you are in the right place, type `ls` (Mac) or `dir` (Windows) and
press Enter. You should see `package.json` and `README.md` in the list. If you
do not, you are in the wrong folder — try the drag trick again.

---

## Step 4 — Install the app's parts (once per download)

Type this and press Enter:

```
npm install
```

Wait. It prints a lot of text and takes 30–60 seconds the first time. When it
stops and you get your cursor back, it worked.

You only do this once per download, not every time you run the app.

> Seeing yellow warnings about "deprecated" packages? Ignore them. Those are
> normal and harmless. Only red **error** text means something went wrong.

---

## Step 5 — Start it

Type this and press Enter:

```
npm run dev
```

After a couple of seconds you will see:

```
   ▲ Next.js 15.5.4
   - Local:        http://localhost:3000
   - Network:      http://192.168.1.42:3000

 ✓ Ready in 1824ms
```

**It is now running.** Open your web browser and go to:

```
http://localhost:3000
```

You should see the Judge Queue page with a box for a team number.

### Important: leave the terminal open

The app runs *inside* that terminal window. If you close it, the app stops.
Minimise it, don't close it.

### Only ever run one copy at a time

If you type `npm run dev` again while it is already running, you get a *second*
copy on port 3001, and the two will overwrite each other's data. The app warns
you loudly when this happens. Always stop the old one with `Ctrl + C` before
starting a new one.

**To stop the app**, click on the terminal and press `Ctrl + C` (yes, `Ctrl`
even on a Mac).

**To start it again later:** open a terminal, `cd` into the folder as in
Step 3, and type `npm run dev`. You do not repeat Steps 1–4.

---

## Step 6 — Have a look around

It starts with fake demo data — 3 judge panels and 24 made-up teams — so there
is something to look at. Try these in your browser:

| Go to | What you'll see |
|---|---|
| `http://localhost:3000` | Team view. Type `1101` and press Continue. |
| `http://localhost:3000/board` | The big colour board. |
| `http://localhost:3000/login` | Staff sign-in. |

At the sign-in page, use the code **`JA2026`** to get into your Judge Advisor
console. Panel codes for the demo judges are `ALPHA1`, `BRAVO2` and `CHARLIE3`.
The queue desk code is **`DESK01`**.

Click around. You cannot break anything — Step 8 shows you how to wipe it all.

---

## Step 7 — Let phones connect to it

`localhost` only works on your own computer. For teams' phones you need the
**Network** address that was printed in Step 5 — the one that looks like
`http://192.168.1.42:3000`.

1. Make sure your computer and the phones are on **the same wifi network**
2. On the phone's browser, type that full Network address, including `:3000`

If it does not load, the usual causes are:

- **The phone is on a different wifi** (or on cellular data). Check.
- **Your computer's firewall is blocking it.** Windows usually shows a popup
  the first time asking to allow Node.js — click **Allow**. If you dismissed
  it, search Windows for "Allow an app through Windows Firewall" and allow
  Node.js on Private networks.
- **Guest wifi.** Many venue and hotel networks deliberately stop devices
  talking to each other. If so, use a phone hotspot instead and connect your
  computer and the teams' phones to that.

**Test this before event day, on the actual venue wifi if you possibly can.**
This is the step most likely to surprise you.

---

## Step 8 — Set up your real event

Sign in at `/login` with `JA2026`.

1. **Teams tab → Reset → Wipe everything.** This deletes the demo teams. Do
   this first or you will spend the day judging the Quantum Quokkas.
2. **Panels tab** — add each judge group. Give each one a name, room and the
   judges' names. Each panel gets its own **code** — write it down and give it
   to that group of judges.
3. **Import tab** — paste your team list, one team per line:
   ```
   1234, Iron Hawks, Pit 12
   9882K, Kilo Kestrels, Pit 13
   ```
   Team numbers can have letters in them, like `9882K` — and it does not matter
   whether anyone types the letter as a capital.
   You can copy straight out of Excel or Google Sheets and paste it in. Tick
   **spread across panels** to share the teams out evenly.
4. **Teams tab** — check it looks right, fix anything by hand.

### Change the codes before the event

`JA2026` and `DESK01` are published in this guide, so anyone reading it knows
them. Before the real day:

1. In the app folder, make a copy of the file `.env.example` and name the copy
   `.env.local`
2. Open it in Notepad or TextEdit and change these two lines to your own codes:
   ```
   ADMIN_CODE=pick-something-only-you-know
   QUEUER_CODE=pick-something-for-the-desk
   ```
3. Stop the app (`Ctrl + C`) and start it again (`npm run dev`)

---

## Step 9 — On the day

Use `npm run dev` if you like — it works fine. If you want it a bit faster,
run these two instead:

```
npm run build
npm start
```

`npm run build` takes about 30 seconds and you only do it once. `npm start`
then launches it, and prints the same Network address for phones.

### The day-of checklist

- [ ] Laptop plugged into power
- [ ] **Sleep disabled** — if the laptop sleeps, the app stops for everyone
      (Windows: Settings → Power; Mac: System Settings → Lock Screen, set
      display-off but never sleep)
- [ ] Terminal window open and running, minimised not closed
- [ ] Network address tested from a phone on the venue wifi
- [ ] `/board` open on the TV in the judges' room, Fullscreen pressed
- [ ] Panel codes handed out to each judge group
- [ ] Team-facing address written somewhere teams can see it

---

## If something goes wrong

**"npm: command not found"**
Node.js is not installed, or the terminal was open before you installed it.
Close the terminal, open a new one, try again. If it persists, redo Step 1.

**"Cannot find module" or similar red errors when starting**
You skipped Step 4, or you are in the wrong folder. Check `ls`/`dir` shows
`package.json`, then run `npm install` again.

**"Port 3000 is in use ... using available port 3001 instead"**
You already have the app running in another terminal window. It did **not**
stop you — it started a *second* copy on a different port, and two copies
fighting over the same data can lose your work.

The app will also print a big `!!!!!` warning saying another copy is running.
When you see either message: press `Ctrl + C` in this window to stop this
second copy, then go back to the terminal window that was already running and
use `http://localhost:3000` as normal.

If you actually wanted to restart, stop the old one **first** (`Ctrl + C` in
its window), then start the new one.

**The page loads but says "not on the list"**
That team number is not imported. Judge Advisor console → Teams tab to check.

**A team is stuck orange and nobody is going to them**
Judge Advisor console → Floor tab → use the dropdown to move them to a
different panel.

**I closed the terminal by accident**
Nothing is lost. Open a terminal, `cd` to the folder, `npm run dev`. Everything
comes back exactly as it was.

**I need to undo a mess**
Judge Advisor console → Teams tab → Reset → **Clear today's requests** empties
the queue but keeps your teams and panels. Use this between a practice run and
the real thing.

---

## Where your data lives

Everything is in one file inside the app folder: **`.data/state.json`**

That file is the entire database. To back it up, copy it somewhere safe. To
restore, copy it back and restart the app.

It saves automatically as people use the app. You never have to press save.
