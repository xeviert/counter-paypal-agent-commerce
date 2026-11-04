"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { opsLogIn, type OpsLoginState } from "../actions";

const ERRORS: Record<NonNullable<OpsLoginState["error"]>, string> = {
  wrong: "Wrong password.",
  tooMany: "Too many attempts. Try again in a few minutes.",
};

export function OpsLoginForm() {
  const [state, action, pending] = useActionState<OpsLoginState, FormData>(opsLogIn, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "password-error" : undefined}
          className="h-11 text-base"
        />
        {state.error && (
          <p id="password-error" role="alert" className="text-xs text-destructive">
            {ERRORS[state.error]}
          </p>
        )}
      </div>
      <Button type="submit" size="lg" className="h-11 text-base" disabled={pending}>
        Sign in
      </Button>
    </form>
  );
}
