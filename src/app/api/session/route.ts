import { NextResponse } from "next/server";
import { createSession, destroySession, getSession, resolveCode } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ session: await getSession() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const code = String(body.code ?? "");
  const name = String(body.name ?? "");

  if (!code.trim()) {
    return NextResponse.json({ error: "Enter your access code." }, { status: 400 });
  }

  const session = await resolveCode(code, name);
  if (!session) {
    return NextResponse.json({ error: "That code was not recognised." }, { status: 401 });
  }

  await createSession(session);
  return NextResponse.json({ session });
}

export async function DELETE() {
  await destroySession();
  return NextResponse.json({ ok: true });
}
