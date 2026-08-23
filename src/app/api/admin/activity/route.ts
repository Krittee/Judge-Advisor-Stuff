import { NextResponse } from "next/server";
import { canReadNotes, getSession } from "@/lib/auth";
import { listActivity } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!canReadNotes(session)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  return NextResponse.json({ activity: listActivity() });
}
