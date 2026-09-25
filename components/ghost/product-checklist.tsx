"use client";

import { AlertCircle, Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { Checkbox } from "@/components/ui/controls";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GhostProduct } from "@/lib/catalogue/queries";
import { cn } from "@/lib/utils";

type JobType = "front_back" | "macro" | "colorways";

type Issue = "needDna" | "needFront" | "needColorways";

function readiness(product: GhostProduct, jobType: JobType): Issue | null {
  if (!product.hasDna) return "needDna";
  if (jobType === "colorways" && !product.hasFront) return "needFront";
  if (jobType === "colorways" && product.colorways.length === 0) return "needColorways";
  return null;
}

export function ProductChecklist({
  products,
  jobType,
  mode,
  selected,
  onSelectedChange,
  macroDetails,
  onMacroDetailsChange,
  colorwayIds,
  onColorwayIdsChange,
}: {
  products: GhostProduct[];
  jobType: JobType;
  mode: "single" | "batch";
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  macroDetails: Record<string, string[]>;
  onMacroDetailsChange: (value: Record<string, string[]>) => void;
  colorwayIds: Record<string, string[]>;
  onColorwayIdsChange: (value: Record<string, string[]>) => void;
}) {
  const t = useTranslations("ghost.products");
  const single = products.find((product) => product.id === selected[0]) ?? null;

  if (mode === "single") {
    const issue = single ? readiness(single, jobType) : null;
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span id="ghost-product-label" className="text-sm font-medium">
            {t("product")}
          </span>
          <Select value={single?.id} onValueChange={(id) => onSelectedChange([id])}>
            <SelectTrigger aria-labelledby="ghost-product-label">
              <SelectValue placeholder={t("choose")} />
            </SelectTrigger>
            <SelectContent>
              {products.map((product) => (
                <SelectItem key={product.id} value={product.id}>
                  {product.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {issue ? (
            <p className="flex items-center gap-1.5 text-xs text-warning">
              <AlertCircle className="size-3.5" aria-hidden />
              {t(`issues.${issue}`)}
            </p>
          ) : null}
        </div>
        {single && jobType === "macro" && single.details.length > 0 ? (
          <DetailChooser
            product={single}
            value={macroDetails[single.id] ?? single.details.slice(0, 2)}
            onChange={(details) => onMacroDetailsChange({ ...macroDetails, [single.id]: details })}
          />
        ) : null}
        {single && jobType === "colorways" && single.colorways.length > 0 ? (
          <ColorwayChooser
            product={single}
            value={colorwayIds[single.id] ?? single.colorways.map((colorway) => colorway.id)}
            onChange={(ids) => onColorwayIdsChange({ ...colorwayIds, [single.id]: ids })}
          />
        ) : null}
      </div>
    );
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 flex w-full items-center justify-between text-sm font-medium">
        {t("batch")}
        <button
          type="button"
          className="text-xs font-normal text-champagne-ink hover:underline"
          onClick={() =>
            onSelectedChange(
              selected.length > 0
                ? []
                : products
                    .filter((product) => !readiness(product, jobType))
                    .map((product) => product.id),
            )
          }
        >
          {selected.length > 0 ? t("clear") : t("selectReady")}
        </button>
      </legend>
      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto pe-1">
        {products.map((product) => {
          const issue = readiness(product, jobType);
          const checked = selected.includes(product.id);
          return (
            <li key={product.id}>
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted",
                  issue && "opacity-60",
                )}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(value) =>
                    onSelectedChange(
                      value
                        ? [...selected, product.id]
                        : selected.filter((id) => id !== product.id),
                    )
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{product.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {issue
                      ? t(`issues.${issue}`)
                      : jobType === "colorways"
                        ? t("colorwayCount", { count: product.colorways.length })
                        : t("ready")}
                  </span>
                </span>
                {!issue ? <Check className="size-4 text-success" aria-hidden /> : null}
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function DetailChooser({
  product,
  value,
  onChange,
}: {
  product: GhostProduct;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const t = useTranslations("ghost.products");
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{t("macroDetails")}</span>
      <p className="text-xs text-muted-foreground">{t("macroHint")}</p>
      <div className="flex flex-wrap gap-1.5">
        {product.details.map((detail) => {
          const active = value.includes(detail);
          return (
            <button
              key={detail}
              type="button"
              aria-pressed={active}
              onClick={() => {
                if (active) onChange(value.filter((item) => item !== detail));
                else onChange([...value, detail].slice(-2));
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-muted",
              )}
            >
              {detail}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ColorwayChooser({
  product,
  value,
  onChange,
}: {
  product: GhostProduct;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const t = useTranslations("ghost.products");
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{t("colorways")}</span>
      <div className="flex flex-wrap gap-2">
        {product.colorways.map((colorway) => {
          const active = value.includes(colorway.id);
          return (
            <button
              key={colorway.id}
              type="button"
              aria-pressed={active}
              onClick={() =>
                onChange(
                  active ? value.filter((id) => id !== colorway.id) : [...value, colorway.id],
                )
              }
              className={cn(
                "inline-flex items-center gap-2 rounded-full border py-1 ps-1 pe-3 text-xs",
                active ? "border-primary" : "border-border opacity-60",
              )}
            >
              <span
                className="size-5 rounded-full border border-border"
                style={{ background: colorway.hex }}
              />
              {colorway.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
