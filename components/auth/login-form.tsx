"use client";

import { Loader2, LogIn } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useEffect } from "react";

import { drainLiquid, pourLiquid } from "@/components/fx/liquid-transition";
import { useFullEffects } from "@/components/fx/use-full-effects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, type SignInState } from "@/lib/actions/auth";

const initialState: SignInState = { error: null };

export function LoginForm() {
  const t = useTranslations("login");
  const [state, formAction, pending] = useActionState(signIn, initialState);
  const full = useFullEffects();

  // Signing in pours the liquid over the page; a successful sign-in lands on the studio and the
  // liquid runs off there. A failed attempt drains it straight back to show the error.
  useEffect(() => {
    if (state.error) drainLiquid();
  }, [state]);

  return (
    <form
      action={formAction}
      onSubmit={() => {
        if (full) void pourLiquid();
      }}
      className="flex flex-col gap-5"
      noValidate
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" dir="ltr" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          required
        />
      </div>
      {state.error ? (
        <p
          role="alert"
          className="rounded-(--radius-control) border border-[color-mix(in_srgb,var(--destructive)_35%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_10%,transparent)] px-3 py-2 text-sm text-destructive"
        >
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="mt-2 w-full">
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <LogIn className="rtl:-scale-x-100" aria-hidden />
        )}
        {t("submit")}
      </Button>
    </form>
  );
}
