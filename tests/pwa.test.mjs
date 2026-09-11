import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
);
const worker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");

test("manifest has the installability essentials", () => {
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  for (const size of ["192x192", "512x512"]) {
    for (const purpose of ["any", "maskable"]) {
      const icon = manifest.icons.find((candidate) =>
        candidate.sizes === size && candidate.purpose === purpose,
      );
      assert.ok(icon);
      const png = readFileSync(new URL(`../public${icon.src}`, import.meta.url));
      assert.equal(png.readUInt32BE(16), Number.parseInt(size));
      assert.equal(png.readUInt32BE(20), Number.parseInt(size));
    }
  }
});

test("service worker preserves live and authenticated behavior", () => {
  assert.match(worker, /request\.method !== "GET"/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /request\.mode === "navigate"/);
  assert.ok(!/cache\.put\([^\n]*navigate/.test(worker));
});

test("service worker is registered only in production", () => {
  assert.match(layout, /process\.env\.NODE_ENV === "production"/);
  assert.match(layout, /updateViaCache: "none"/);
  assert.match(layout, /registration\.unregister\(\)/);
});
