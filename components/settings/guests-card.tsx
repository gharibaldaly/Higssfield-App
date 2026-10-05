"use client";

import { ExternalLink, Loader2, UserMinus, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/common/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addGuestAction, revokeGuestAction } from "@/lib/actions/guests";
import type { GuestAccount } from "@/lib/auth/guests";

/**
 * Who else may sign in, and into what: guests see only Generate and their
 * own history, which the owner can open from here. Adding an email lists it;
 * the account itself is created in Supabase (Authentication → Users), since
 * sign-ups are closed.
 */
export function GuestsCard({ guests }: { guests: GuestAccount[] }) {
  const t = useTranslations("settings.guests");
  const router = useRouter();
  const confirm = useConfirm();
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) toast.error(result.error ?? t("failed"));
      else {
        toast.success(done);
        setEmail("");
        router.refresh();
      }
    });
  }

  async function revoke(guest: GuestAccount) {
    const ok = await confirm({
      title: t("revokeTitle", { email: guest.email }),
      description: t("revokeBody"),
      confirmLabel: t("revoke"),
      destructive: true,
    });
    if (!ok) return;
    run(() => revokeGuestAction(guest.email), t("revoked"));
  }

  const active = guests.filter((guest) => !guest.revokedAt);
  const revokedGuests = guests.filter((guest) => guest.revokedAt);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-5 text-accent-ink" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {active.map((guest) => (
              <li key={guest.email} className="flex flex-wrap items-center gap-2 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-sm font-medium" dir="ltr">
                    {guest.email}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="muted">{t("generateOnly")}</Badge>
                    {guest.userId ? (
                      <Badge variant="success">
                        {guest.lastSignInAt ? t("signedIn") : t("accountReady")}
                      </Badge>
                    ) : (
                      <Badge variant="warning">{t("noAccount")}</Badge>
                    )}
                  </span>
                </div>
                {guest.userId ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/generate?history=${guest.userId}`}>
                      <ExternalLink aria-hidden />
                      {t("history")}
                    </Link>
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => void revoke(guest)}
                >
                  <UserMinus aria-hidden />
                  {t("revoke")}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!email.trim()) return;
            run(() => addGuestAction(email.trim()), t("added"));
          }}
        >
          <Label htmlFor="guest-email">{t("add")}</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="guest-email"
              type="email"
              autoComplete="off"
              placeholder="name@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              dir="ltr"
              className="min-w-0 flex-1"
            />
            <Button type="submit" disabled={pending || !email.trim()}>
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <UserPlus aria-hidden />
              )}
              {t("addButton")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("accountHint")}</p>
        </form>

        {revokedGuests.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <p className="hud text-muted-foreground">{t("revokedHeading")}</p>
            <ul className="flex flex-wrap gap-1.5">
              {revokedGuests.map((guest) => (
                <li key={guest.email} className="flex items-center gap-1">
                  <Badge variant="outline" dir="ltr">
                    {guest.email}
                  </Badge>
                  {guest.userId ? (
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/generate?history=${guest.userId}`}>{t("history")}</Link>
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => addGuestAction(guest.email), t("restored"))}
                  >
                    {t("restore")}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
