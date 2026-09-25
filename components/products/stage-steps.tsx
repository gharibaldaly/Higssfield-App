import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import type { ProductStage } from "@/lib/domain/product";
import { cn } from "@/lib/utils";

const ORDER: ProductStage[] = ["photos", "dna", "dna_approved", "sheet_approved"];

/** Compact progress dots: photos → DNA → DNA approved → sheet approved. */
export function StageSteps({ stage, className }: { stage: ProductStage; className?: string }) {
  const t = useTranslations("products.stage");
  const reached = ORDER.indexOf(stage);
  return (
    <div className={cn("flex items-center gap-1.5", className)} aria-label={t(stage)}>
      {ORDER.map((step, index) => (
        <span
          key={step}
          title={t(step)}
          className={cn(
            "grid size-5 place-items-center rounded-full border text-[11px]",
            index <= reached
              ? "border-transparent bg-primary text-primary-foreground"
              : "border-border text-muted-foreground",
          )}
        >
          {index <= reached ? <Check className="size-3" aria-hidden /> : index + 1}
        </span>
      ))}
      <span className="ms-1 text-xs text-muted-foreground">{t(stage)}</span>
    </div>
  );
}
