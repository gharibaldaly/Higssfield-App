"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";
import { useState } from "react";

import { GhostForm } from "@/components/fx/ghost-form";
import { AccountMenu } from "@/components/layout/account-menu";
import { BrandMark } from "@/components/layout/brand-mark";
import { isActive, NAV_ITEMS, SOON_ITEMS } from "@/components/layout/nav-items";
import { EffectsToggle, LocaleToggle, ThemeToggle } from "@/components/layout/preference-toggles";
import { Button } from "@/components/ui/button";
import type { Effects, Theme } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

export type ShellProps = {
  email: string | null;
  theme: Theme;
  effects: Effects;
  mockImages: boolean;
  mockBrain: boolean;
};

/**
 * The index: a full-screen menu that floods the screen in the inverse colour, with every section
 * in display type, the coming-soon modules, and (on small screens) the preferences.
 */
export function IndexOverlay({ email, theme, effects }: ShellProps) {
  const t = useTranslations("nav");
  const tb = useTranslations("topBar");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button variant="surface" size="sm" className="h-9 gap-2.5 ps-3.5 pe-3">
          <span className="hud">{tb("menu")}</span>
          <span aria-hidden className="flex w-4 flex-col items-end gap-[4px]">
            <span className="h-px w-full bg-current" />
            <span className="h-px w-2/3 bg-current" />
          </span>
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="index-overlay inverse-scope fixed inset-0 z-50 flex flex-col overflow-y-auto bg-inverse text-inverse-foreground outline-none"
        >
          <DialogPrimitive.Title className="sr-only">{tb("menu")}</DialogPrimitive.Title>
          <div className="mx-auto flex h-16 w-full max-w-[1680px] shrink-0 items-center gap-3 px-4 sm:px-6 lg:px-10">
            <BrandMark />
            <DialogPrimitive.Close className="ms-auto inline-flex h-9 items-center gap-2 rounded-full border border-current/30 px-3.5 transition-colors hover:bg-current/10">
              <span className="hud">{tb("closeMenu")}</span>
              <X className="size-4" aria-hidden />
            </DialogPrimitive.Close>
          </div>

          <div className="mx-auto grid w-full max-w-[1680px] flex-1 items-center gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:px-10">
            <nav aria-label={t("label")}>
              <ul className="fx-stagger flex flex-col [&:hover>li:not(:hover)]:opacity-45">
                {NAV_ITEMS.map((item, index) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <li
                      key={item.href}
                      className="border-b border-current/15 transition-opacity duration-300 first:border-t"
                      style={{ "--i": index } as React.CSSProperties}
                    >
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className="group flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3 sm:py-4"
                      >
                        <span className="flex items-baseline gap-3">
                          <span className="font-display text-[clamp(2.1rem,5.4vw,4.75rem)] leading-[1.08] transition-transform duration-500 ease-(--ease-spring) group-hover:translate-x-3 rtl:group-hover:-translate-x-3">
                            {t(item.key)}
                          </span>
                          {active ? (
                            <span
                              aria-hidden
                              className="size-2.5 shrink-0 rounded-full bg-current"
                            />
                          ) : null}
                        </span>
                        <span className="hud opacity-85">{t(`hint.${item.key}`)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <GhostForm className="hidden h-[min(72vh,760px)] lg:block" />
          </div>

          <div className="mx-auto w-full max-w-[1680px] shrink-0 border-t border-current/15 px-4 py-5 sm:px-6 lg:px-10">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <p className="hud opacity-85">{t("soonHeading")}</p>
              <ul className="flex flex-wrap gap-2">
                {SOON_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.key}>
                      <span
                        aria-disabled="true"
                        className="inline-flex cursor-not-allowed items-center gap-2 rounded-full border border-dashed border-current/40 px-3 py-1.5 text-sm"
                      >
                        <Icon className="size-4 opacity-80" aria-hidden />
                        {t(`soon.${item.key}`)}
                        <span className="hud opacity-85">{t("soonBadge")}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className={cn("ms-auto flex flex-wrap items-center gap-1.5 md:hidden")}>
                <EffectsToggle effects={effects} />
                <LocaleToggle />
                <ThemeToggle theme={theme} />
                <AccountMenu email={email} />
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
