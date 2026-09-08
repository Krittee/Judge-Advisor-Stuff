"use client";

import { SignInForm } from "@/components/SignInForm";

/**
 * The referees' own door.
 *
 * Same code box as /login — the code still decides the role — but a
 * referee handed this address never has to wonder whether "judge / staff
 * sign in" was meant for them.
 */
export default function RefereeLoginPage() {
  return (
    <SignInForm
      title="Referee sign in"
      intro="For referees on the field. Your code was given to you by the Judge Advisor."
    />
  );
}
