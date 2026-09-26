"use client";

import { Camera, Dna, LayoutPanelLeft, Palette } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/** The product's workroom tabs, in working order. */
export function ProductSubnav({ productId }: { productId: string }) {
  const t = useTranslations("products.subnav");
  const pathname = usePathname();
  const base = `/products/${productId}`;
  const items = [
    { href: base, label: t("intake"), icon: Camera },
    { href: `${base}/dna`, label: t("dna"), icon: Dna },
    { href: `${base}/colorways`, label: t("colorways"), icon: Palette },
    { href: `${base}/sheet`, label: t("sheet"), icon: LayoutPanelLeft },
  ];
  return (
    <nav aria-label={t("label")} className="mb-10 border-b border-border">
      <ul className="flex gap-7 overflow-x-auto">
        {items.map((item, index) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-12 items-center gap-2.5 rounded-t-md text-sm font-medium whitespace-nowrap transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="hud" dir="ltr">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Icon className="size-4" aria-hidden />
                {item.label}
                {active ? (
                  <motion.span
                    layoutId="product-subnav"
                    aria-hidden
                    className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary"
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
