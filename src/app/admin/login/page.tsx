"use client";

import { SignInForm } from "@/components/SignInForm";

/** The Judge Advisor's own door. Same code box as /login; the code still decides the role. */
export default function AdminLoginPage() {
  return (
    <SignInForm
      title="Judge Advisor sign in"
      intro="Judge Advisors sign in here to run the event."
      door="admin"
    />
  );
}
