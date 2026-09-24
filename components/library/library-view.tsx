"use client";

import { BadgeCheck, Download, Heart, Images } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { GenerationMedia, StorageImage } from "@/components/generation/generation-media";
import { useGenerationPolling } from "@/components/generation/use-generation-polling";
import { ProductLineBadge } from "@/components/products/product-line-badge";
import { StageSteps } from "@/components/products/stage-steps";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { setGenerationFavorite } from "@/lib/actions/generations";
import type { ProductStage, ProductLine } from "@/lib/domain/product";
import type { LibraryFilters, LibraryItem } from "@/lib/library/queries";
import { cn } from "@/lib/utils";

const PURPOSES = [
  "ghost_front",
  "ghost_back",
  "macro",
  "colorway",
  "product_sheet",
  "shot_preview",
  "shot_video",
] as const;
const TABS = ["generations", "products", "dna", "sheets", "colorways"] as const;

export function LibraryView({
  tab,
  filters,
  items,
  products,
  dna,
  sheets,
  colorways,
}: {
  tab: string;
  filters: LibraryFilters;
  items: LibraryItem[];
  products: {
    id: string;
    name: string;
    productLine: ProductLine;
    coverUrl: string | null;
    stage: ProductStage;
  }[];
  dna: {
    id: string;
    productId: string;
    productName: string;
    version: number;
    status: string;
    source: string;
    createdAt: string;
  }[];
  sheets: {
    id: string;
    productId: string;
    productName: string;
    version: number;
    status: string;
    url: string | null;
  }[];
  colorways: {
    id: string;
    productId: string;
    productName: string;
    name: string;
    hex: string;
    swatchUrl: string | null;
  }[];
}) {
  const t = useTranslations("library");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const active = (TABS as readonly string[]).includes(tab) ? tab : "generations";

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-6">
      <Tabs
        value={active}
        onValueChange={(value) => setParam("tab", value === "generations" ? null : value)}
      >
        <TabsList>
          {TABS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(`tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {active === "generations" ? (
        <>
          <div className="flex flex-wrap gap-2">
            <FilterSelect
              value={filters.kind}
              placeholder={t("filters.kind")}
              options={[
                ["image", t("filters.images")],
                ["video", t("filters.videos")],
              ]}
              onChange={(value) => setParam("kind", value)}
              allLabel={t("filters.all")}
            />
            <FilterSelect
              value={filters.purpose}
              placeholder={t("filters.purpose")}
              options={PURPOSES.map(
                (purpose) => [purpose, t(`purposes.${purpose}`)] as [string, string],
              )}
              onChange={(value) => setParam("purpose", value)}
              allLabel={t("filters.all")}
            />
            <FilterSelect
              value={filters.status}
              placeholder={t("filters.status")}
              options={[
                ["completed", t("filters.completed")],
                ["pending", t("filters.pending")],
                ["failed", t("filters.failed")],
              ]}
              onChange={(value) => setParam("status", value)}
              allLabel={t("filters.all")}
            />
            <FilterSelect
              value={filters.product}
              placeholder={t("filters.product")}
              options={products.map((product) => [product.id, product.name] as [string, string])}
              onChange={(value) => setParam("product", value)}
              allLabel={t("filters.all")}
            />
            <Button
              variant={filters.favorites ? "default" : "glass"}
              size="sm"
              className="h-10"
              onClick={() => setParam("favorites", filters.favorites ? null : "1")}
            >
              <Heart aria-hidden />
              {t("filters.favorites")}
            </Button>
            <Button
              variant={filters.approved ? "default" : "glass"}
              size="sm"
              className="h-10"
              onClick={() => setParam("approved", filters.approved ? null : "1")}
            >
              <BadgeCheck aria-hidden />
              {t("filters.approved")}
            </Button>
          </div>
          <GenerationGrid items={items} />
        </>
      ) : null}

      {active === "products" ? (
        products.length === 0 ? (
          <EmptyState icon={Images} title={t("empty.title")} description={t("empty.description")} />
        ) : (
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {products.map((product) => (
              <li key={product.id}>
                <Link href={`/products/${product.id}`}>
                  <Card className="overflow-hidden">
                    <StorageImage
                      src={product.coverUrl}
                      alt={product.name}
                      fit="cover"
                      className="aspect-[4/5] w-full"
                    />
                    <div className="flex flex-col gap-2 p-3">
                      <p className="truncate font-medium">{product.name}</p>
                      <ProductLineBadge line={product.productLine} />
                      <StageSteps stage={product.stage} />
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {active === "dna" ? (
        <Card className="overflow-x-auto p-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-start text-xs text-muted-foreground">
                <th className="px-3 py-2 text-start font-medium">{t("columns.product")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("columns.version")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("columns.status")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("columns.source")}</th>
              </tr>
            </thead>
            <tbody>
              {dna.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Link
                      className="hover:underline"
                      href={`/products/${row.productId}/dna?v=${row.id}`}
                    >
                      {row.productName}
                    </Link>
                  </td>
                  <td className="px-3 py-2" dir="ltr">
                    v{row.version}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={row.status === "approved" ? "success" : "muted"}>
                      {t(`dnaStatus.${row.status as "draft"}`)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {t(`dnaSource.${row.source as "llm"}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {active === "sheets" ? (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sheets.map((sheet) => (
            <li key={sheet.id}>
              <Link href={`/products/${sheet.productId}/sheet?s=${sheet.id}`}>
                <Card className="overflow-hidden">
                  <StorageImage
                    src={sheet.url}
                    alt={sheet.productName}
                    className="aspect-video w-full bg-[#FAF8F5]"
                  />
                  <div className="flex items-center justify-between gap-2 p-3">
                    <span className="truncate font-medium">
                      {sheet.productName} · v{sheet.version}
                    </span>
                    <Badge variant={sheet.status === "approved" ? "success" : "muted"}>
                      {t(`sheetStatus.${sheet.status as "draft"}`)}
                    </Badge>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {active === "colorways" ? (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
          {colorways.map((colorway) => (
            <li key={colorway.id}>
              <Link href={`/products/${colorway.productId}/colorways`}>
                <Card className="overflow-hidden">
                  <div className="relative h-24" style={{ background: colorway.hex }}>
                    {colorway.swatchUrl ? (
                      <StorageImage
                        src={colorway.swatchUrl}
                        alt={colorway.name}
                        fit="cover"
                        className="absolute inset-y-0 end-0 w-1/2"
                      />
                    ) : null}
                  </div>
                  <div className="p-3 text-sm">
                    <p className="truncate font-medium">{colorway.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{colorway.productName}</p>
                    <p className="font-mono text-xs" dir="ltr">
                      {colorway.hex}
                    </p>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FilterSelect({
  value,
  placeholder,
  options,
  onChange,
  allLabel,
}: {
  value: string | undefined;
  placeholder: string;
  options: [string, string][];
  onChange: (value: string | null) => void;
  allLabel: string;
}) {
  return (
    <Select
      value={value ?? "__all"}
      onValueChange={(next) => onChange(next === "__all" ? null : next)}
    >
      <SelectTrigger className="w-auto min-w-40" aria-label={placeholder}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">
          {placeholder}: {allLabel}
        </SelectItem>
        {options.map(([optionValue, label]) => (
          <SelectItem key={optionValue} value={optionValue}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function GenerationGrid({ items }: { items: LibraryItem[] }) {
  const t = useTranslations("library");
  const format = useFormatter();
  const router = useRouter();
  const { views } = useGenerationPolling(items, { onSettled: () => router.refresh() });
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [, startTransition] = useTransition();

  if (items.length === 0) {
    return (
      <EmptyState icon={Images} title={t("empty.title")} description={t("empty.description")} />
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {items.map((item) => {
        const view = views.get(item.id) ?? item;
        const favorite = favorites[item.id] ?? item.isFavorite;
        return (
          <li key={item.id}>
            <Card className="overflow-hidden p-2">
              <GenerationMedia
                view={view}
                alt={item.productName ?? t(`purposes.${item.purpose as "ghost_front"}`)}
                className={cn(
                  "w-full",
                  item.purpose === "product_sheet"
                    ? "aspect-video"
                    : item.kind === "video"
                      ? "aspect-[9/16]"
                      : "aspect-[4/5]",
                )}
              />
              <div className="flex items-start gap-2 px-1 pt-2 pb-1">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.productName ?? "—"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t(`purposes.${item.purpose as "ghost_front"}`)} ·{" "}
                    {format.relativeTime(new Date(item.createdAt), new Date())}
                  </p>
                  {item.reviewStatus === "approved" ? (
                    <Badge variant="success" className="mt-1">
                      <BadgeCheck aria-hidden />
                      {t("approvedBadge")}
                    </Badge>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-pressed={favorite}
                  aria-label={favorite ? t("unfavorite") : t("favorite")}
                  onClick={() =>
                    startTransition(async () => {
                      setFavorites((current) => ({ ...current, [item.id]: !favorite }));
                      const result = await setGenerationFavorite(item.id, !favorite);
                      if (!result.ok) {
                        setFavorites((current) => ({ ...current, [item.id]: favorite }));
                        toast.error(result.error);
                      }
                    })
                  }
                >
                  <Heart className={cn(favorite && "fill-rose text-rose")} aria-hidden />
                </Button>
                {item.downloadUrl && view.status === "completed" ? (
                  <Button variant="ghost" size="icon-sm" asChild>
                    <a href={item.downloadUrl} aria-label={t("download")}>
                      <Download aria-hidden />
                    </a>
                  </Button>
                ) : null}
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
