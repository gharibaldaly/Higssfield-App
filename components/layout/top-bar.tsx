"use client";

import { FlaskConical, LogOut, Menu, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { AppNav } from "@/components/layout/app-nav";
import { BrandMark } from "@/components/layout/brand-mark";
import { LocaleToggle, ThemeToggle } from "@/components/layout/preference-toggles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/overlays";
import { signOut } from "@/lib/actions/auth";

export function TopBar({
  email,
  theme,
  mockImages,
  mockBrain,
}: {
  email: string | null;
  theme: "dark" | "light";
  mockImages: boolean;
  mockBrain: boolean;
}) {
  const t = useTranslations("topBar");
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 px-4 pt-4 sm:px-6 lg:px-8">
      <div className="specular mx-auto flex h-14 max-w-[1600px] items-center gap-2 rounded-full ps-2 pe-2 glass sm:ps-3">
        <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label={t("openMenu")}>
              <Menu />
            </Button>
          </DialogTrigger>
          <DialogContent
            className="top-4 max-w-sm translate-y-0 data-[state=open]:slide-in-from-top-4"
            closeLabel={t("closeMenu")}
          >
            <DialogTitle className="sr-only">{t("openMenu")}</DialogTitle>
            <BrandMark />
            <AppNav onNavigate={() => setMenuOpen(false)} layoutId="nav-active-mobile" />
          </DialogContent>
        </Dialog>
        <div className="lg:hidden">
          <BrandMark />
        </div>

        <div className="ms-auto flex items-center gap-2">
          {mockImages || mockBrain ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="warning" className="hidden cursor-help sm:inline-flex">
                  <FlaskConical aria-hidden />
                  {t("mockMode")}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {[mockImages ? t("mockImages") : null, mockBrain ? t("mockBrain") : null]
                  .filter(Boolean)
                  .join(" ")}
              </TooltipContent>
            </Tooltip>
          ) : null}
          <LocaleToggle />
          <ThemeToggle theme={theme} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="glass" size="icon-sm" className="size-9" aria-label={t("account")}>
                <UserRound />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="max-w-56 truncate">
                {email ?? t("owner")}
              </DropdownMenuLabel>
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
        </div>
      </div>
    </header>
  );
}
