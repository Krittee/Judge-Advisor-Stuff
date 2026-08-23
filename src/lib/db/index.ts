import { fileStore } from "./file";
import { postgresStore } from "./postgres";
import type { Store } from "./types";

export { StoreError } from "./types";
export type { Store } from "./types";

/**
 * Pick a backend.
 *
 * Set DATABASE_URL and it uses Postgres — that is the deployed path,
 * where there is no disk to keep a file on. Leave it unset and it uses a
 * JSON file, which is what makes `npm run dev` work with no setup at all.
 */
let chosen: Store | null = null;

export function store(): Store {
  if (chosen) return chosen;

  chosen = process.env.DATABASE_URL ? postgresStore : fileStore;
  console.log(`[store] using ${chosen.describe()}`);
  return chosen;
}
