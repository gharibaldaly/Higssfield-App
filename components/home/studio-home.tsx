"use client";

import {
  ArrowRight,
  BadgeCheck,
  Clapperboard,
  Dna,
  Ghost,
  Hourglass,
  LayoutPanelLeft,
  Plus,
  Settings,
  Shirt,
  Sparkles,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { GoldRule } from "@/components/common/page-header";
import { GenerationMedia } from "@/components/generation/generation-media";
import { useGenerationPolling } from "@/components/generation/use-generation-polling";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { GenerationView } from "@/lib/domain/generation";

type Stats = {
  products: number;
  approvedDna: number;
  approvedSheets: number;
  ads: number;
  pending: number;
  approvedImages: number;
};

export function StudioHome({
  stats,
  recent,
  setup,
}: {
  stats: Stats;
  recent: GenerationView[];
  setup: { higgsfield: boolean; brain: boolean; webhook: boolean };
}) {
  const t = useTranslations("home");
  const router = useRouter();
  const { views } = useGenerationPolling(recent, { onSettled: () => router.refresh() });
  const tiles = [
    { key: "products", value: stats.products, icon: Shirt, href: "/products" },
    { key: "approvedDna", value: stats.approvedDna, icon: Dna, href: "/products" },
    {
      key: "approvedSheets",
      value: stats.approvedSheets,
      icon: LayoutPanelLeft,
      href: "/products",
    },
    {
      key: "approvedImages",
      value: stats.approvedImages,
      icon: BadgeCheck,
      href: "/library?approved=1",
    },
    { key: "pending", value: stats.pending, icon: Hourglass, href: "/library?status=pending" },
    { key: "ads", value: stats.ads, icon: Clapperboard, href: "/ads" },
  ] as const;
  const actions = [
    { key: "newProduct", href: "/products/new", icon: Plus },
    { key: "ghost", href: "/ghost", icon: Ghost },
    { key: "ads", href: "/ads", icon: Clapperboard },
  ] as const;

  return (
    <div className="flex flex-col gap-8">
      <section className="specular relative overflow-hidden rounded-[2rem] px-6 py-10 glass-strong sm:px-10">
        <div className="pointer-events-none absolute -end-24 -top-24 size-80 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--color-champagne)_40%,transparent),transparent_65%)] blur-2xl" />
        <p className="text-xs font-semibold tracking-[0.2em] text-champagne-ink uppercase">
          {t("eyebrow")}
        </p>
        <h1 className="mt-3 max-w-3xl font-display text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl">
          {t("heading")}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {t("subheading")}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {actions.map((action, index) => {
            const Icon = action.icon;
            return (
              <Button
                key={action.key}
                asChild
                variant={index === 0 ? "default" : "glass"}
                size="lg"
              >
                <Link href={action.href}>
                  <Icon aria-hidden />
                  {t(`actions.${action.key}`)}
                </Link>
              </Button>
            );
          })}
        </div>
      </section>

      {!setup.higgsfield || !setup.brain ? (
        <Card className="border-warning/40">
          <CardContent className="flex flex-wrap items-center gap-4">
            <Sparkles className="size-6 shrink-0 text-warning" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t("setup.title")}</p>
              <p className="text-sm text-muted-foreground">
                {[
                  !setup.higgsfield ? t("setup.higgsfield") : null,
                  !setup.brain ? t("setup.brain") : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
              </p>
            </div>
            <Button asChild variant="glass">
              <Link href="/settings">
                <Settings aria-hidden />
                {t("setup.action")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((tile, index) => {
          const Icon = tile.icon;
          return (
            <motion.li
              key={tile.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Link href={tile.href} className="block focus-visible:outline-none">
                <Card className="p-5 transition-transform duration-300 hover:-translate-y-1">
                  <Icon className="size-5 text-champagne-ink" aria-hidden />
                  <p className="mt-4 font-display text-4xl font-semibold" dir="ltr">
                    {tile.value}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{t(`stats.${tile.key}`)}</p>
                </Card>
              </Link>
            </motion.li>
          );
        })}
      </ul>

      <Card>
        <CardHeader className="flex-row flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle>{t("recent.title")}</CardTitle>
            <CardDescription>{t("recent.hint")}</CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/library">
              {t("recent.all")}
              <ArrowRight className="rtl:-scale-x-100" aria-hidden />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <GoldRule className="mb-5" />
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("recent.empty")}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {recent.map((item) => {
                const view = views.get(item.id) ?? item;
                return (
                  <li key={item.id}>
                    <GenerationMedia
                      view={view}
                      alt={t("recent.alt")}
                      className={
                        view.kind === "video" ? "aspect-[9/16] w-full" : "aspect-[4/5] w-full"
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
