import { awards } from "@/lib/presets";

/** The longest reason a judge can give for a nomination; longer is cut, as a note is. */
export const REASON_MAX = 500;

/**
 * A write's fields: the JSON body, over the query string. DELETE bodies are
 * legal but not every client sends one, and the other DELETE routes read the
 * query, so either works.
 */
export async function fields(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  return {
    ...Object.fromEntries(new URL(request.url).searchParams),
    ...(body && typeof body === "object" ? body : {}),
  };
}

/** An award's name for the log. An id the config no longer lists reads as itself. */
export const awardLabel = (id: string): string => awards().find((a) => a.id === id)?.label ?? id;
