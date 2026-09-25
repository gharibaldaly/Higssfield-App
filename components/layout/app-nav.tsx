"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { isActive, NAV_ITEMS, SOON_ITEMS } from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";

export function AppNav({
  onNavigate,
  layoutId = "nav-active",
}: {
  onNavigate?: () => void;
  layoutId?: string;
}) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  return (
    <nav aria-label={t("label")} className="flex flex-col gap-6">
      <ul className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-11 items-center gap-3 rounded-2xl px-3.5 text-sm font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId={layoutId}
                    className="absolute inset-0 rounded-2xl glass"
                    transition={{ type: "spring", stiffness: 380, damping: 34 }}
                  />
                ) : null}
                <Icon
                  className={cn("relative size-[18px]", active && "text-champagne-ink")}
                  aria-hidden
                />
                <span className="relative">{t(item.key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div>
        <p className="mb-2 px-3.5 text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
          {t("soonHeading")}
        </p>
        <ul className="flex flex-col gap-0.5">
          {SOON_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.key}>
                <span
                  aria-disabled="true"
                  className="flex h-10 cursor-not-allowed items-center gap-3 rounded-2xl px-3.5 text-sm text-muted-foreground/80"
                >
                  <Icon className="size-[18px] opacity-70" aria-hidden />
                  <span className="flex-1 truncate">{t(`soon.${item.key}`)}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase">
                    {t("soonBadge")}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
