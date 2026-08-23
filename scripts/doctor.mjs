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

/* ---- 2. Dependencies ---------------------------------------------- */
if (existsSync("node_modules/next")) {
  const v = JSON.parse(readFileSync("node_modules/next/package.json", "utf8")).version;
  ok(`Dependencies installed (Next.js ${v})`);
} else {
  bad("Dependencies are not installed", "Run:  npm install");
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

/* ---- 6. Secrets ---------------------------------------------------- */
const hasEnvFile = existsSync(".env.local") || existsSync(".env");
if (process.env.NODE_ENV === "production") {
  for (const key of ["SESSION_SECRET", "ADMIN_CODE"]) {
    if (!process.env[key]) {
      bad(`${key} is not set, and production refuses to run without it`, `Set ${key} and restart.`);
    }
  }
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
