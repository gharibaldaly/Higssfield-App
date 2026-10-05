"use client";

import { LogOut, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import { signOut } from "@/lib/actions/auth";
import type { StudioRole } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

export function AccountMenu({
  email,
  role,
  className,
}: {
  email: string | null;
  role: StudioRole;
  className?: string;
}) {
  const t = useTranslations("topBar");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="surface"
          size="icon-sm"
          className={cn("size-9", className)}
          aria-label={t("account")}
        >
          <UserRound />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="max-w-64 truncate" dir="ltr">
          {email ?? t(role)}
        </DropdownMenuLabel>
        <p className="px-2 pb-1.5 hud text-muted-foreground">{t(`role.${role}`)}</p>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            void signOut();
          }}
        >
          <LogOut aria-hidden />
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
