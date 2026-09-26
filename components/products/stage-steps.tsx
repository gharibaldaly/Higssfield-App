import { useTranslations } from "next-intl";
import { Fragment } from "react";

import type { ProductStage } from "@/lib/domain/product";
import { cn } from "@/lib/utils";

const ORDER: ProductStage[] = ["photos", "dna", "dna_approved", "sheet_approved"];

/** Progress as knots on a thread: photos → DNA → DNA approved → sheet approved. */
export function StageSteps({ stage, className }: { stage: ProductStage; className?: string }) {
  const t = useTranslations("products.stage");
  const reached = ORDER.indexOf(stage);
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span aria-hidden className="flex items-center" dir="ltr">
        {ORDER.map((step, index) => (
          <Fragment key={step}>
            {index > 0 ? (
              <span
                className={cn(
                  "w-4",
                  index <= reached ? "h-px bg-primary" : "stitch text-border-strong",
                )}
              />
            ) : null}
            <span
              title={t(step)}
              className={cn(
                "size-2.5 rounded-full border",
                index <= reached ? "border-primary bg-primary" : "border-border-strong",
              )}
            />
          </Fragment>
        ))}
      </span>
      <span className="text-xs text-muted-foreground">{t(stage)}</span>
    </div>
  );
}
