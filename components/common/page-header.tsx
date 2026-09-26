import * as React from "react";

import { LiquidTitle } from "@/components/fx/liquid-title";
import { cn } from "@/lib/utils";

/**
 * Page opening: a small label, the title in display type (written in on arrival), an optional
 * description and actions, then a seam drawn across the page.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("relative mb-10 lg:mb-14", className)}>
      {eyebrow ? (
        <div className="mb-5 flex items-center gap-3 text-accent-ink">
          <span aria-hidden className="h-px w-8 bg-current" />
          {typeof eyebrow === "string" ? <p className="hud">{eyebrow}</p> : eyebrow}
        </div>
      ) : null}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-5xl min-w-0">
          <h1 className="font-display text-[clamp(2.6rem,6.2vw,5.75rem)] leading-[1.04] tracking-tight text-balance">
            {typeof title === "string" ? <LiquidTitle text={title} /> : title}
          </h1>
          {description ? (
            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      <SeamRule className="stitch-draw mt-8 lg:mt-10" />
    </header>
  );
}

export function SectionTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2 className={cn("font-heading text-2xl leading-tight tracking-tight", className)}>
      {children}
    </h2>
  );
}

/** A running stitch across the width, used between sections. */
export function SeamRule({ className }: { className?: string }) {
  return <div aria-hidden className={cn("stitch text-border-strong", className)} />;
}
