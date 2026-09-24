"use client";

import { Loader2, LockKeyhole } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction } from "@/lib/actions/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

export function PasswordCard() {
  const t = useTranslations("settings.password");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= MIN_PASSWORD_LENGTH && confirm === password;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    startTransition(async () => {
      const result = await changePasswordAction(password);
      if (result.ok) {
        toast.success(t("changed"));
        setPassword("");
        setConfirm("");
        return;
      }
      const reason =
        result.reason === "invalid"
          ? "tooShort"
          : result.reason === "session"
            ? "reauth"
            : result.reason;
      toast.error(t(`errors.${reason}`));
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LockKeyhole className="size-5 text-champagne-ink" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-password">{t("newPassword")}</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={tooShort || undefined}
              aria-describedby={tooShort ? "new-password-error" : undefined}
              dir="ltr"
            />
            {tooShort ? (
              <p id="new-password-error" className="text-xs text-destructive">
                {t("errors.tooShort")}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm-password">{t("confirm")}</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              aria-invalid={mismatch || undefined}
              aria-describedby={mismatch ? "confirm-password-error" : undefined}
              dir="ltr"
            />
            {mismatch ? (
              <p id="confirm-password-error" className="text-xs text-destructive">
                {t("errors.mismatch")}
              </p>
            ) : null}
          </div>
          <Button type="submit" disabled={!ready || pending} className="self-start">
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {t("save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
