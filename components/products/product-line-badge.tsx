import { useTranslations } from "next-intl";

import type { ProductLine } from "@/lib/domain/product";
import { cn } from "@/lib/utils";

/** Each line keeps its label colours in both themes, like a physical woven label. */
const WEAVE: Record<ProductLine, string> = {
  SECRET: "bg-[#ffb8cb] text-[#2a0714]",
  HOURS: "bg-[#86e7c0] text-[#062a22]",
  VOWS: "bg-[#f3efe8] text-[#062a22]",
};

/** Product line as a woven garment label: ribbed weave, folded ends, stitched down. */
export function ProductLineBadge({ line, className }: { line: ProductLine; className?: string }) {
  const t = useTranslations("products.lines");
  return (
    <span className={cn("woven-label", WEAVE[line], className)}>
      <span className="font-mono text-[11px] font-medium tracking-[0.2em]">{line}</span>
      <span className="text-xs opacity-80">{t(line)}</span>
    </span>
  );
}
