import type { LucideIcon } from "lucide-react";
import * as React from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Empty state with guidance: what this area is for and the next step. */
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
    <Card className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      <div className="specular relative mb-5 grid size-16 place-items-center rounded-3xl bg-[linear-gradient(145deg,color-mix(in_srgb,var(--color-champagne)_35%,transparent),color-mix(in_srgb,var(--color-wine)_30%,transparent))]">
        <Icon className="size-7 text-champagne-ink" aria-hidden />
      </div>
      <h3 className="font-display text-2xl font-semibold">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {steps && steps.length > 0 ? (
        <ol className="mt-6 flex max-w-md flex-col gap-2 text-start text-sm">
          {steps.map((step, index) => (
            <li key={index} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
                {index + 1}
              </span>
              <span className="pt-0.5 text-muted-foreground">{step}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {action ? <div className="mt-7">{action}</div> : null}
    </Card>
  );
}
