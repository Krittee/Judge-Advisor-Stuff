import test from "node:test";

import { runStoreConformance } from "./storeConformance.runtime";

/**
 * The same conformance suite against Postgres.
 *
 * Skipped unless a database is offered, because most people running these
 * tests -- on a laptop, before an event -- have no Postgres and should not
 * need one. Point TEST_DATABASE_URL at a throwaway database and the whole
 * suite runs against the deployed backend instead:
 *
 *   TEST_DATABASE_URL=postgres://localhost/judge_queue_test npm test
 *
 * It is a separate variable from DATABASE_URL on purpose. These tests call
 * resetAll() between every case, and resetAll truncates the roster. Reusing
 * the deployment's own variable would let one careless shell wipe a live
 * event, so the suite refuses to run on anything but a name it was given
 * for the purpose.
 */
const url = process.env.TEST_DATABASE_URL;

if (!url) {
  test("postgres: conformance", { skip: "set TEST_DATABASE_URL to run these" }, () => {});
} else {
  process.env.DATABASE_URL = url;
  runStoreConformance("postgres", async () => {
    const { postgresStore } = await import("../src/lib/db/postgres");
    return postgresStore;
  });
}
