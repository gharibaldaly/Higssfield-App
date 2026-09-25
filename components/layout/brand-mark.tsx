import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/** Wordmark with an embroidered monogram patch (a stitched ring). Inherits the text colour. */
export function BrandMark({
  className,
  subtitle = true,
}: {
  className?: string;
  subtitle?: boolean;
}) {
  const t = useTranslations("app");
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <span
        aria-hidden
        className="relative grid size-10 shrink-0 place-items-center rounded-full border border-current/35"
      >
        <span className="absolute inset-[3px] rounded-full border border-dashed border-current/45" />
        <span className="font-editorial text-lg leading-none">S</span>
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="font-editorial text-xl leading-none tracking-tight" dir="ltr">
          {t("brand")}
        </span>
        {subtitle ? <span className="mt-1 truncate hud opacity-75">{t("studio")}</span> : null}
      </span>
    </span>
  );
}
