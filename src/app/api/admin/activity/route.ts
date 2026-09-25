import { NextResponse } from "next/server";
import { canAdminister, getSession } from "@/lib/auth";
import { store } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  return NextResponse.json({ activity: await store().listActivity() });
}
