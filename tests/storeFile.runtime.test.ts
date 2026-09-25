import { join } from "node:path";
import { tmpdir } from "node:os";

import { runStoreConformance } from "./storeConformance.runtime";

/**
 * The conformance suite against the JSON file store.
 *
 * This one always runs: it is the backend `npm run dev` uses and the one
 * a laptop at the venue runs on, so there is never a reason to skip it.
 *
 * The data file is named before the module is imported because file.ts
 * resolves DATA_FILE once, at load. Node's test runner gives each test
 * file its own process, so that single resolution is ours alone.
 */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-conformance-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";

runStoreConformance("file", async () => {
  const { fileStore } = await import("../src/lib/db/file");
  return fileStore;
});
