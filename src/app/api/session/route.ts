import { NextResponse } from "next/server";
import {
  clientKeyFor,
  createSession,
  destroySession,
  getSession,
  loginRateLimited,
  recordLoginFailure,
  recordLoginSuccess,
  resolveCode,
} from "@/lib/auth";

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

  const key = clientKeyFor(request);
  const throttle = loginRateLimited(key);
  if (throttle.limited) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSeconds ?? 60) } },
    );
  }

  const session = await resolveCode(code, name);
  if (!session) {
    recordLoginFailure(key);
    return NextResponse.json({ error: "That code was not recognised." }, { status: 401 });
  }

  recordLoginSuccess(key);
  await createSession(session);
  return NextResponse.json({ session });
}

export async function DELETE() {
  await destroySession();
  return NextResponse.json({ ok: true });
}
