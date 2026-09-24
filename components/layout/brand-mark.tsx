import { useTranslations } from "next-intl";

export function BrandMark() {
  const t = useTranslations("app");
  return (
    <div className="flex items-center gap-3">
      <div className="specular relative grid size-10 place-items-center rounded-2xl bg-[linear-gradient(145deg,var(--color-wine-600),var(--color-wine))] text-cream shadow-[0_10px_30px_-12px_rgba(77,0,17,0.9)]">
        <span className="font-display text-xl leading-none font-semibold italic" aria-hidden>
          S
        </span>
      </div>
      <div className="leading-tight">
        <p className="font-display text-lg font-semibold tracking-tight">{t("brand")}</p>
        <p className="text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          {t("studio")}
        </p>
      </div>
    </div>
  );
}
