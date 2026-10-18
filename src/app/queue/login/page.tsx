"use client";

import { SignInForm } from "@/components/SignInForm";

/** The queue desk's own door. Same code box as /login; the code still decides the role. */
export default function QueueLoginPage() {
  return (
    <SignInForm
      title="Queue desk sign in"
      intro="Queue desk staff sign in here to send judges to teams."
      door="queuer"
    />
  );
}
