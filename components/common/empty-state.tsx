import type { LucideIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Empty state with guidance: what this area is for and the next step. Drawn as a pattern sheet:
 * a dashed cutting line around faint grid paper.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  steps,
  action,
  className,
}: {
  icon: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  steps?: React.ReactNode[];
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-(--radius-panel) border border-dashed border-border-strong bg-[color-mix(in_srgb,var(--surface-solid)_84%,transparent)] px-6 py-14 text-center sm:py-16",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] mask-[radial-gradient(ellipse_at_center,#000_25%,transparent_72%)] bg-size-[28px_28px]"
      />
      <div className="relative flex flex-col items-center">
        <span className="relative mb-6 grid size-16 place-items-center rounded-full border border-current/30 text-accent-ink">
          <span
            aria-hidden
            className="absolute inset-1 rounded-full border border-dashed border-current/45"
          />
          <Icon className="size-6" aria-hidden />
        </span>
        <h2 className="font-heading text-3xl leading-tight">{title}</h2>
        {description ? (
          <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
        {steps && steps.length > 0 ? (
          <ol className="mt-7 flex max-w-md flex-col gap-2.5 text-start text-sm">
            {steps.map((step, index) => (
              <li key={index} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border-strong font-mono text-xs">
                  {index + 1}
                </span>
                <span className="pt-0.5 text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {action ? <div className="mt-8">{action}</div> : null}
      </div>
    </div>
  );
}
