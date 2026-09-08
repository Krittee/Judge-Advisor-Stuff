"use client";

import { SignInForm } from "@/components/SignInForm";

/**
 * One code box for every staff role. The code itself decides whether
 * you land on the judge console, the queue console or the JA console —
 * nobody has to remember which URL they were told to use.
 *
 * Referees have their own door at /referee/login. It is the same box;
 * it just says so, because "judge and staff" does not obviously include
 * someone who has come off the field.
 */
export default function LoginPage() {
  return (
    <SignInForm
      title="Staff sign in"
      intro="For judges, queue staff and Judge Advisors. Teams do not need to sign in."
    />
  );
}
