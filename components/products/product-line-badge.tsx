import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { ProductLine } from "@/lib/domain/product";

const VARIANT: Record<ProductLine, "rose" | "champagne" | "muted"> = {
  SECRET: "rose",
  HOURS: "champagne",
  VOWS: "muted",
};

export function ProductLineBadge({ line }: { line: ProductLine }) {
  const t = useTranslations("products.lines");
  return (
    <Badge variant={VARIANT[line]} className="tracking-wide">
      <span className="font-semibold">{line}</span>
      <span className="opacity-80">· {t(line)}</span>
    </Badge>
  );
}
