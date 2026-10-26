#!/usr/bin/env node
/**
 * Checks the things that actually stop this app from starting, and says
 * what to do about each in plain language.
 *
 * Written for someone who does not read stack traces: every failure ends
 * with the exact command or click that fixes it.
 */

import { createConnection } from "node:net";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const problems = [];
const warnings = [];

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m, fix) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  problems.push({ m, fix });
};
const warn = (m, fix) => {
  console.log(`  \x1b[33m!\x1b[0m ${m}`);
  warnings.push({ m, fix });
};

/* ---- Environment ---------------------------------------------------
 *
 * The app reads .env.local / .env through Next, so this has to as well:
 * looking only at process.env reported "no DATABASE_URL" and "no codes
 * set" for a deployment that had both, and then said all good.
 * Loaded the way Next does it, in the same precedence, via the loader
 * Next itself uses. Dynamic and guarded because this script exists to
 * explain a broken install, so it must still run when node_modules is
 * missing -- check 2 reports that.
 */
const forStart = process.argv.includes("--for-start");
try {
  const { default: nextEnv } = await import("@next/env");
  const isDev = !forStart && process.env.NODE_ENV !== "production";
  nextEnv.loadEnvConfig(process.cwd(), isDev, { info() {}, error: console.error });
} catch {
  /* dependencies are not installed; check 2 says so */
}

/* Mirrors isProductionLike() in src/lib/auth.ts: NODE_ENV or a database
   URL. `npm start` runs this BEFORE next start sets NODE_ENV, so
   --for-start counts too. */
const productionLike =
  forStart || process.env.NODE_ENV === "production" || Boolean(process.env.DATABASE_URL);

console.log("\nChecking whether this app can run here…\n");

/* ---- 1. Node ------------------------------------------------------ */
const major = Number(process.versions.node.split(".")[0]);
const minor = Number(process.versions.node.split(".")[1]);
if (major > 18 || (major === 18 && minor >= 18)) {
  ok(`Node.js ${process.versions.node}`);
} else {
  bad(
    `Node.js ${process.versions.node} is too old (need 18.18 or newer)`,
    "Install the LTS version from https://nodejs.org, then close this window and open a new one.",
  );
}

/* ---- 2. Dependencies ----------------------------------------------
 *
 * Checks every declared dependency, not just that node_modules exists.
 * Pulling code that added a package leaves an install that looks fine
 * until the build fails on a module you have never heard of.
 */
if (!existsSync("node_modules")) {
  bad("Dependencies are not installed", "Run:  npm install");
} else {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const missing = Object.keys(pkg.dependencies ?? {}).filter(
    (name) => !existsSync(`node_modules/${name}`),
  );

  if (missing.length) {
    bad(
      `Out of date: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} in package.json but not installed`,
      "Run:  npm install     (this happens after you pull new code)",
    );
  } else {
    const v = JSON.parse(readFileSync("node_modules/next/package.json", "utf8")).version;
    ok(`Dependencies installed (Next.js ${v})`);
  }

  // pg is optional on purpose: only the Postgres backend needs it.
  if (process.env.DATABASE_URL && !existsSync("node_modules/pg")) {
    bad(
      "DATABASE_URL is set but the 'pg' database driver is not installed",
      "Run:  npm install     (or unset DATABASE_URL to use the local file)",
    );
  }
}

/* ---- 3. Are we even in the right folder? -------------------------- */
if (existsSync("package.json") && existsSync("src/app")) {
  ok("Running from the project folder");
} else {
  bad(
    "This does not look like the project folder",
    "Use `cd` to move into the folder that contains package.json, then try again.",
  );
}

/* ---- 4. Preset config --------------------------------------------- */
if (existsSync("config/event.json")) {
  try {
    const cfg = JSON.parse(readFileSync("config/event.json", "utf8"));
    const divisions = Array.isArray(cfg.divisions) ? cfg.divisions.length : 0;
    const panels = Array.isArray(cfg.panels) ? cfg.panels.length : 0;
    ok(`config/event.json is valid (${divisions} divisions, ${panels} panels)`);

    const codes = (cfg.panels ?? []).map((p) => String(p?.code ?? "").toUpperCase());
    if (new Set(codes).size !== codes.length) {
      warn(
        "Two preset panels share the same code",
        "Give every panel in config/event.json a different code, or judges will land on the wrong panel.",
      );
    }

    /* Renaming the divisions and forgetting the panels is easy to do and
       silent: a panel naming a division that no longer exists is quietly
       moved to the first one, so every panel piles into one division and
       the others cannot be auto-assigned at all. */
    const named = Array.isArray(cfg.divisions) ? cfg.divisions.map((d) => String(d).trim()) : [];
    const stranded = (cfg.panels ?? []).filter(
      (p) => p?.division && !named.includes(String(p.division).trim()),
    );
    if (named.length && stranded.length) {
      const wrong = [...new Set(stranded.map((p) => String(p.division).trim()))];
      warn(
        `${stranded.length} preset panel${stranded.length === 1 ? "" : "s"} name a division that no longer exists`,
        `They say ${wrong.map((w) => `"${w}"`).join(", ")}, but divisions are ` +
          `${named.map((d) => `"${d}"`).join(", ")}. They will all be moved into ` +
          `"${named[0]}". Update each panel's "division" in config/event.json.`,
      );
    }

    /* Even with every name spelled right, a division with no panel cannot
       take an auto-assign: it fails with "No judge panels in X yet." */
    if (named.length && Array.isArray(cfg.panels) && cfg.panels.length) {
      const covered = new Set(
        cfg.panels
          .map((p) => String(p?.division ?? "").trim())
          .map((d) => (named.includes(d) ? d : named[0])),
      );
      const empty = named.filter((d) => !covered.has(d));
      if (empty.length) {
        warn(
          `No preset panel judges ${empty.map((d) => `"${d}"`).join(", ")}`,
          "Auto-assign in that division will have nowhere to put its teams. " +
            "Add a panel for it in config/event.json, or create one in the Judge Advisor console.",
        );
      }
    }
  } catch (e) {
    bad(
      `config/event.json is not valid JSON — ${e.message}`,
      "Open config/event.json and look for a missing comma, quote or bracket.",
    );
  }
} else {
  warn("config/event.json is missing", "The app still runs; you just get no preset panels.");
}

/* ---- 5. Can we write the data file? ------------------------------- */
const dataFile = resolve(process.env.DATA_FILE ?? ".data/state.json");
if (process.env.DATABASE_URL) {
  ok("DATABASE_URL is set — using Postgres, no data file needed");
} else {
  try {
    mkdirSync(dirname(dataFile), { recursive: true });
    const probe = `${dataFile}.probe`;
    writeFileSync(probe, "ok");
    rmSync(probe);
    ok(`Can save data to ${dataFile}`);
  } catch (e) {
    bad(
      `Cannot write to ${dataFile} — ${e.message}`,
      "Move the project somewhere you can write to, such as your Documents folder.",
    );
  }
}

/* Judge sign-in and every interview hang off a panel. A fresh production
   file store starts with none, and nothing else complains: the app runs,
   the board loads, and judging is silently impossible. Read-only. */
if (process.env.DATABASE_URL) {
  console.log("  - Not checking for judge panels: they live in Postgres, not a file.");
} else {
  // Same rule as the file store's first load: demo data (which has
  // panels) unless it is production or SEED_DEMO says otherwise.
  const seedsDemo =
    process.env.SEED_DEMO === "true" ||
    (process.env.SEED_DEMO !== "false" && !(forStart || process.env.NODE_ENV === "production"));
  let panelCount = null;
  if (existsSync(dataFile)) {
    try {
      const saved = JSON.parse(readFileSync(dataFile, "utf8"));
      panelCount = Array.isArray(saved.panels) ? saved.panels.length : 0;
    } catch {
      /* unreadable: the app recovers on its own, and that is not this check's job */
    }
  } else if (!seedsDemo) {
    panelCount = 0;
  }
  if (panelCount === 0) {
    warn(
      "No judge panels yet — judging is unusable until you add one",
      "Sign in as the Judge Advisor, open the Panels tab, and add one.",
    );
  }
}

/* ---- 6. Secrets ---------------------------------------------------- */
const hasEnvFile = existsSync(".env.local") || existsSync(".env");

/* The codes printed in this repo's docs. MIRRORS PUBLISHED_CODES in
   src/lib/auth.ts, which this script cannot import (it is TypeScript) --
   tests/authHardening.test.ts fails if the two lists drift apart. */
const PUBLISHED_CODES = new Set(["JA2026", "DESK01", "REF001", "HREF01", "ALPHA1", "BRAVO2", "CHARLIE3"]);

if (productionLike) {
  const found = problems.length + warnings.length;

  // Same rules as secret() in src/lib/auth.ts. The app refuses < 16 and
  // the placeholder; 16-31 still works, so that is a note, not a failure.
  const secret = process.env.SESSION_SECRET ?? "";
  if (!secret) {
    bad("SESSION_SECRET is not set, and production refuses to run without it", "Set SESSION_SECRET and restart.");
  } else if (secret.length < 16) {
    bad(
      `SESSION_SECRET is only ${secret.length} characters, and production refuses anything under 16`,
      "Set it to something long and random:  openssl rand -base64 32",
    );
  } else if (/change-?me/i.test(secret)) {
    bad(
      "SESSION_SECRET is still the placeholder from .env.example, and production refuses it",
      "Set it to something long and random:  openssl rand -base64 32",
    );
  } else if (secret.length < 32) {
    warn(
      `SESSION_SECRET is only ${secret.length} characters — 32 or more is recommended`,
      "It works, so nothing is broken. To strengthen it, set a new one (openssl rand -base64 32); " +
        "everyone signed in will have to sign in again.",
    );
  }

  if (!process.env.ADMIN_CODE) {
    bad("ADMIN_CODE is not set, and production refuses to run without it", "Set ADMIN_CODE and restart.");
  }
  for (const key of ["QUEUER_CODE", "REFEREE_CODE", "HEAD_REFEREE_CODE"]) {
    if (!process.env[key]) {
      warn(
        `${key} is not set, so that role cannot sign in`,
        `Set ${key} if you need it. Production has no fallback code.`,
      );
    }
  }

  // Production refuses these even when set on purpose, which leaves that
  // role locked out; say so here rather than on event day.
  for (const key of ["ADMIN_CODE", "ADMIN_CODE_2", "ADMIN_CODE_3", "ADMIN_CODE_4", "QUEUER_CODE", "REFEREE_CODE", "HEAD_REFEREE_CODE"]) {
    const code = (process.env[key] ?? "").trim().toUpperCase();
    if (PUBLISHED_CODES.has(code)) {
      bad(
        `${key} is "${code}", a code printed in this project's documentation`,
        `Anyone can read it, so production refuses it and that role cannot sign in. Choose your own ${key} and restart.`,
      );
    }
  }

  if (problems.length + warnings.length === found) ok("Session secret and access codes are set");
} else if (hasEnvFile) {
  ok("Found your .env.local settings");
} else {
  warn(
    "No .env.local — development defaults will be used (admin code JA2026)",
    "Fine for trying it out. Before your event: copy .env.example to .env.local and change the codes.",
  );
}

/* ---- 7. Is the port free? ----------------------------------------- */
const port = Number(process.env.PORT ?? 3000);
const inUse = await new Promise((done) => {
  const socket = createConnection({ port, host: "127.0.0.1" })
    .on("connect", () => {
      socket.destroy();
      done(true);
    })
    .on("error", () => done(false));
  setTimeout(() => {
    socket.destroy();
    done(false);
  }, 1000);
});

if (inUse) {
  warn(
    `Something is already using port ${port}`,
    "It is probably this app in another window. Use that one, or press Ctrl+C there first — " +
      "otherwise you get a SECOND copy on port 3001 and the two will overwrite each other's data.",
  );
} else {
  ok(`Port ${port} is free`);
}

/* ---- 8. Production build present, if that is what you are running -- */
if (process.argv.includes("--for-start") && !existsSync(".next/BUILD_ID")) {
  bad(
    "There is no production build yet",
    "Run:  npm run build      (then npm start). Or just use `npm run dev`, which needs no build.",
  );
}

/* ---- verdict ------------------------------------------------------- */
console.log("");

for (const { m, fix } of warnings) {
  console.log(`\x1b[33mNote:\x1b[0m ${m}\n      ${fix}\n`);
}

if (!problems.length) {
  console.log("\x1b[32mAll good.\x1b[0m Start it with:  npm run dev\n");
  process.exit(0);
}

console.log(`\x1b[31m${problems.length} thing(s) to fix:\x1b[0m\n`);
for (const [i, { m, fix }] of problems.entries()) {
  console.log(`  ${i + 1}. ${m}\n     → ${fix}\n`);
}
console.log("Fix those, then run:  npm run check\n");
process.exit(1);
