"use client";

import { SignInForm } from "@/components/SignInForm";

/** The judges' own door. Same code box as /login; the code still decides the role. */
export default function JudgeLoginPage() {
  return (
    <SignInForm
      title="Judge sign in"
      intro="Judges sign in here to run interviews for their panel."
      door="judge"
    />
  );
}
