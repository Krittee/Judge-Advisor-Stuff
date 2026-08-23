import { NextResponse } from "next/server";
import { loadState } from "@/lib/data";
import { isConfigured } from "@/lib/supabase";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * The polling endpoint every screen hits. Kept deliberately boring: no
 * secrets, no notes, one query burst, and an ETag so an unchanged board
 * costs a 304 instead of a payload.
 */
export async function GET(request: Request) {
  if (!isConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  try {
    // Signed-in staff see the notes teams leave; the public payload omits them.
    const session = await getSession();
    const state = await loadState(session !== null);

    // serverTime changes every call, so hash everything else.
    const { serverTime: _t, ...stable } = state;
    const etag = `W/"${session ? "s" : "p"}${hash(JSON.stringify(stable))}"`;

    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag } });
    }

    return NextResponse.json(state, {
      headers: { ETag: etag, "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}

function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
