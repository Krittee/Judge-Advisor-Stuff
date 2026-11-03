"use client";

import { SignInForm } from "@/components/SignInForm";

/** The coordinators' own door. Same code box as /login; the code still decides the role. */
export default function CoordinatorLoginPage() {
  return (
    <SignInForm
      title="Coordinator sign in"
      intro="Coordinators sign in here to set team languages and book judges from the pits."
      door="coordinator"
    />
  );
}
