"use client";

import { Camera, Dna, LayoutPanelLeft, Palette } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

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
    <nav
      aria-label={t("label")}
      className="mb-8 inline-flex max-w-full gap-1 overflow-x-auto rounded-full p-1 glass"
    >
      {items.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors",
              active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active ? (
              <motion.span
                layoutId="product-subnav"
                className="absolute inset-0 rounded-full bg-primary"
              />
            ) : null}
            <Icon className="relative size-4" aria-hidden />
            <span className="relative">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
