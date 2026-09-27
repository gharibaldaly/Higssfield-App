"use client";

import { ArrowUpRight, Clapperboard, Ghost, Plus, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type * as React from "react";

import { HangTag } from "@/components/common/hang-tag";
import { GhostForm } from "@/components/fx/ghost-form";
import { GreaseCircle } from "@/components/fx/grease-circle";
import { LiquidTitle } from "@/components/fx/liquid-title";
import { Magnetic } from "@/components/fx/magnetic";
import { Marquee } from "@/components/fx/marquee";
import { RollingNumber } from "@/components/fx/rolling-number";
import { ScrollBoost } from "@/components/fx/scroll-boost";
import { Doodles, RingText, ScribbleArrow, Starburst, type Doodle } from "@/components/fx/stickers";
import { GenerationMedia } from "@/components/generation/generation-media";
import { useGenerationPolling } from "@/components/generation/use-generation-polling";
import { LineBands } from "@/components/home/line-bands";
import { SOON_ITEMS } from "@/components/layout/nav-items";
import { Button } from "@/components/ui/button";
import type { GenerationView } from "@/lib/domain/generation";
import { cn } from "@/lib/utils";

type Stats = {
  products: number;
  approvedDna: number;
  approvedSheets: number;
  ads: number;
  pending: number;
  approvedImages: number;
};

/**
 * Construction lines called out beside the form, at the heights the shader draws them
 * (top %, measured from the form's projection), alternating sides so the labels never collide.
 * `reach` is how close to the centre each leader line ends, in % of the panel width.
 */
const CALLOUTS = [
  { key: "neckline", top: 11.3, side: "end", reach: 6 },
  { key: "shoulder", top: 14.6, side: "start", reach: 19 },
  { key: "waist", top: 38.9, side: "end", reach: 13 },
  { key: "hem", top: 65.9, side: "start", reach: 18 },
] as const;

/** Line drawings around the hero, clear of the title and the form's construction labels. */
const HERO_DOODLES: Doodle[] = [
  { kind: "sparkle", top: "3%", start: "46%", size: 22, depth: 0.5 },
  { kind: "needle", top: "9%", start: "93%", size: 30, depth: 1.1, rotate: 12 },
  { kind: "zigzag", top: "76%", start: "1%", size: 34, depth: 0.8 },
  { kind: "button", top: "86%", start: "44%", size: 24, depth: 1.4 },
  { kind: "cross", top: "34%", start: "97%", size: 16, depth: 0.7 },
  { kind: "spool", top: "58%", start: "49%", size: 26, depth: 1.2, rotate: -10 },
  { kind: "heart", top: "18%", start: "40%", size: 16, depth: 0.9, rotate: 8 },
];

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
  const tn = useTranslations("nav");
  const router = useRouter();
  const { views } = useGenerationPolling(recent, { onSettled: () => router.refresh() });

  const steps = [
    { key: "products", value: stats.products, href: "/products" },
    { key: "approvedDna", value: stats.approvedDna, href: "/products" },
    { key: "approvedSheets", value: stats.approvedSheets, href: "/products" },
    { key: "approvedImages", value: stats.approvedImages, href: "/library?approved=1" },
    { key: "ads", value: stats.ads, href: "/ads" },
  ] as const;

  return (
    <div className="flex flex-col gap-20 lg:gap-28">
      {/* Hero: the thesis beside the form it is made for, with the workroom's stickers around it. */}
      <section className="relative grid min-h-[calc(100dvh-10rem)] items-center gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Doodles items={HERO_DOODLES} className="hidden text-accent-ink opacity-80 md:block" />
        <div className="relative flex flex-col">
          <div className="mb-6 flex items-center gap-3 text-accent-ink">
            <span aria-hidden className="h-px w-8 bg-current" />
            <p className="hud">{t("eyebrow")}</p>
          </div>
          <h1 className="font-display text-[clamp(3.1rem,8.2vw,8.25rem)] leading-[1] tracking-tight text-balance">
            <LiquidTitle text={t("heading")} />
          </h1>
          <p className="mt-8 max-w-xl text-base leading-relaxed text-muted-foreground">
            {t("subheading")}
          </p>
          <div className="relative mt-20 flex flex-wrap items-center gap-3">
            <div
              aria-hidden
              className="absolute start-36 -top-16 hidden items-end gap-1 text-accent-ink sm:flex"
            >
              <ScribbleArrow className="h-12 w-20 ltr:-scale-x-100" />
              <span className="mb-7 rounded-full border border-current px-3 py-1 hud">
                {t("hints.start")}
              </span>
            </div>
            <Magnetic>
              <Button asChild size="lg">
                <Link href="/products/new">
                  <Plus aria-hidden />
                  {t("actions.newProduct")}
                </Link>
              </Button>
            </Magnetic>
            <Button asChild size="lg" variant="outline">
              <Link href="/ghost">
                <Ghost aria-hidden />
                {t("actions.ghost")}
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="/ads">
                <Clapperboard aria-hidden />
                {t("actions.ads")}
              </Link>
            </Button>
          </div>
        </div>

        <figure className="sd-hero-lift relative h-[min(74vh,720px)] min-h-[420px]">
          <GhostForm className="absolute inset-0" spin="scroll" />
          <figcaption className="sr-only">{t("form.label")}</figcaption>
          <div aria-hidden className="absolute inset-0 hidden sm:block">
            {CALLOUTS.map((callout) => (
              <div
                key={callout.key}
                className="absolute inset-x-0"
                style={{ top: `${callout.top}%` }}
              >
                <span
                  className={cn(
                    "absolute top-0 h-px bg-border-strong",
                    callout.side === "end" ? "end-0" : "start-0",
                  )}
                  style={{ width: `${50 - callout.reach}%` }}
                >
                  <span
                    className={cn(
                      "absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary",
                      callout.side === "end" ? "-start-0.5" : "-end-0.5",
                    )}
                  />
                </span>
                <span
                  className={cn(
                    "absolute bottom-1.5 hud whitespace-nowrap text-muted-foreground",
                    callout.side === "end" ? "end-0" : "start-0",
                  )}
                >
                  {t(`form.${callout.key}`)}
                </span>
              </div>
            ))}
          </div>
          <Starburst
            value="100%"
            label={t("stickers.fidelity")}
            className="absolute start-[2%] bottom-[3%] w-28 text-[12px] sm:w-32 sm:text-[13px]"
          />
          <RingText
            id="hero-ring"
            text={t("stickers.ring")}
            className="absolute start-[4%] top-[30%] w-24 text-accent-ink sm:w-28"
          />
        </figure>

        <div
          aria-hidden
          className="absolute inset-x-0 -bottom-6 mx-auto hidden w-fit flex-col items-center gap-2 text-muted-foreground lg:flex"
        >
          <span className="rounded-full border border-current px-3 py-1 hud">
            {t("hints.scroll")}
          </span>
          <svg
            viewBox="0 0 16 24"
            className="nudge h-6 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 2v19M2 15l6 6 6-6" />
          </svg>
        </div>
      </section>

      {!setup.higgsfield || !setup.brain ? (
        <HangTag
          icon={<Sparkles className="size-5" aria-hidden />}
          title={t("setup.title")}
          action={
            <Button asChild variant="surface" size="sm">
              <Link href="/settings">
                <Settings aria-hidden />
                {t("setup.action")}
              </Link>
            </Button>
          }
        >
          {[
            !setup.higgsfield ? t("setup.higgsfield") : null,
            !setup.brain ? t("setup.brain") : null,
          ]
            .filter(Boolean)
            .join(" ")}
        </HangTag>
      ) : null}

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] lg:gap-12">
        {/* The production line as a work ticket that follows each garment. */}
        <section
          aria-labelledby="pipeline-title"
          className="ticket rounded-(--radius-panel) surface"
        >
          <header className="flex flex-col gap-1.5 px-6 pt-6">
            <h2 id="pipeline-title" className="font-heading text-2xl leading-tight">
              {t("pipeline.title")}
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{t("pipeline.hint")}</p>
          </header>
          <ol className="fx-stagger px-2 py-4">
            {steps.map((step, index) => (
              <li key={step.key} style={{ "--i": index } as React.CSSProperties}>
                <Link
                  href={step.href}
                  className="group flex items-baseline gap-4 rounded-(--radius-control) px-4 py-3 transition-colors hover:bg-muted"
                >
                  <span className="w-6 shrink-0 hud text-muted-foreground" dir="ltr">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[15px]">{t(`stats.${step.key}`)}</span>
                  <span
                    aria-hidden
                    className="min-w-6 flex-1 -translate-y-1 border-b border-dotted border-border-strong transition-colors group-hover:border-primary"
                  />
                  <RollingNumber
                    value={step.value}
                    className="font-editorial text-3xl leading-none"
                  />
                </Link>
              </li>
            ))}
          </ol>
          <footer className="flex h-15 items-center border-t border-dashed border-border-strong px-6">
            <Link
              href="/library?status=pending"
              className="inline-flex items-center gap-2.5 rounded-full text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <span
                aria-hidden
                className={cn(
                  "size-2 rounded-full",
                  stats.pending > 0 ? "animate-pulse-soft bg-success" : "bg-border-strong",
                )}
              />
              {t("pipeline.live", { count: stats.pending })}
            </Link>
          </footer>
        </section>

        {/* Latest results on a contact sheet; approved frames get a grease-pencil ring. */}
        <section aria-labelledby="recent-title">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="recent-title" className="font-heading text-2xl leading-tight">
                {t("recent.title")}
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{t("recent.hint")}</p>
            </div>
            <Button asChild variant="link">
              <Link href="/library">
                {t("recent.all")}
                <ArrowUpRight className="rtl:-scale-x-100" aria-hidden />
              </Link>
            </Button>
          </div>
          <div className="contact-sheet rounded-(--radius-panel) px-4 sm:px-5">
            {recent.length === 0 ? (
              <p className="py-16 text-center text-sm">{t("recent.empty")}</p>
            ) : (
              <ul className="fx-stagger grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
                {recent.map((item, index) => {
                  const view = views.get(item.id) ?? item;
                  const approved = view.reviewStatus === "approved";
                  return (
                    <li
                      key={item.id}
                      className="relative"
                      style={{ "--i": index } as React.CSSProperties}
                    >
                      <div className="relative">
                        <GenerationMedia
                          view={view}
                          alt={t("recent.alt")}
                          className="aspect-[4/5] w-full rounded-[4px]"
                          controls={false}
                        />
                        {approved ? (
                          <GreaseCircle className="absolute -start-2 -top-2 h-[calc(100%+1rem)] w-[calc(100%+1rem)]" />
                        ) : null}
                      </div>
                      <p className="mt-2 flex items-center justify-between gap-2 font-mono text-[11px]">
                        <span dir="ltr">{String(index + 1).padStart(2, "0")}A</span>
                        {approved ? (
                          <span className="text-(--grease)">{t("recent.approved")}</span>
                        ) : (
                          <span className="truncate opacity-80" dir="ltr">
                            {view.modelId}
                          </span>
                        )}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* The three product lines as colour bands the form passes through. */}
      <LineBands />

      {/* The modules still to come, as a ticker that speeds up with the scroll. */}
      <section
        aria-labelledby="soon-title"
        className="-mx-4 border-y border-border py-7 sm:-mx-6 lg:-mx-10"
      >
        <h2 id="soon-title" className="sr-only">
          {tn("soonHeading")}
        </h2>
        <ScrollBoost>
          <Marquee
            label={tn("soonHeading")}
            items={SOON_ITEMS.map((item) => (
              <span key={item.key} className="flex items-center gap-4">
                <span className="font-display text-[clamp(2rem,4vw,3.25rem)] leading-none whitespace-nowrap">
                  {tn(`soon.${item.key}`)}
                </span>
                <span className="rounded-full border border-border-strong px-2.5 py-1 hud text-muted-foreground">
                  {tn("soonBadge")}
                </span>
              </span>
            ))}
            itemClassName="gap-10 pe-10"
            separator={
              <span aria-hidden className="relative grid size-4 place-items-center text-accent-ink">
                <span className="absolute inset-0 rounded-full border border-dashed border-current" />
                <span className="size-1 rounded-full bg-current" />
              </span>
            }
          />
        </ScrollBoost>
      </section>
    </div>
  );
}
