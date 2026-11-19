"use client";

import { SignInForm } from "@/components/SignInForm";

/** Marketing's own door. Same code box as /login; the code still decides the role. */
export default function MarketingLoginPage() {
  return (
    <SignInForm
      title="Marketing sign in"
      intro="Marketing signs in here to see the awards as the Judge Advisor sends them."
      door="marketing"
    />
  );
}
