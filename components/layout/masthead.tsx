"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { AccountMenu } from "@/components/layout/account-menu";
import { BrandMark } from "@/components/layout/brand-mark";
import { IndexOverlay, type ShellProps } from "@/components/layout/index-overlay";
import { isActive, NAV_ITEMS } from "@/components/layout/nav-items";
import { EffectsToggle, LocaleToggle, ThemeToggle } from "@/components/layout/preference-toggles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";

/** The studio's top bar: wordmark, section links with a stitched underline, preferences, index. */
export function Masthead(props: ShellProps) {
  const { email, theme, effects, mockImages, mockBrain } = props;
  const t = useTranslations("nav");
  const tb = useTranslations("topBar");
  const pathname = usePathname();
  const mock = mockImages || mockBrain;
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-[color-mix(in_srgb,var(--background)_74%,transparent)] backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-16 max-w-[1680px] items-center gap-3 px-4 sm:px-6 lg:px-10">
        <Link href="/" className="shrink-0 rounded-full" aria-label={t("studio")}>
          <BrandMark className="[&_.hud]:hidden sm:[&_.hud]:block" />
        </Link>

        <nav aria-label={t("label")} className="mx-auto hidden lg:block">
          <ul className="flex items-center">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative block rounded-md px-3.5 py-2 text-sm font-medium transition-colors",
                      active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(`short.${item.key}`)}
                    {active ? (
                      <motion.span
                        layoutId="masthead-stitch"
                        aria-hidden
                        className="absolute inset-x-3.5 -bottom-[3px] stitch text-primary"
                        style={{ height: 2 }}
                        transition={{ type: "spring", stiffness: 380, damping: 34 }}
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="absolute inset-x-3.5 -bottom-[3px] stitch scale-x-0 text-border-strong transition-transform duration-500 ease-(--ease-silk) group-hover:scale-x-100 ltr:origin-left rtl:origin-right"
                      />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ms-auto flex items-center gap-1.5 lg:ms-0">
          {mock ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="hidden cursor-help items-center gap-2 rounded-full border border-warning/40 px-3 py-1.5 text-warning sm:inline-flex"
                >
                  <span
                    aria-hidden
                    className="size-1.5 animate-pulse-soft rounded-full bg-warning"
                  />
                  <span className="hud">{tb("mockMode")}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {[mockImages ? tb("mockImages") : null, mockBrain ? tb("mockBrain") : null]
                  .filter(Boolean)
                  .join(" ")}
              </TooltipContent>
            </Tooltip>
          ) : null}
          <div className="hidden items-center gap-1.5 md:flex">
            <EffectsToggle effects={effects} />
            <LocaleToggle />
            <ThemeToggle theme={theme} />
            <AccountMenu email={email} />
          </div>
          <IndexOverlay {...props} />
        </div>
      </div>
    </header>
  );
}
