"use client";

import { ArrowUpRight, Heart, Palette } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type * as React from "react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { StorageImage } from "@/components/generation/generation-media";
import { ProductLineBadge } from "@/components/products/product-line-badge";
import { StageSteps } from "@/components/products/stage-steps";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { setProductFavoriteAction } from "@/lib/actions/products";
import { PRODUCT_LINES, type ProductLine } from "@/lib/domain/product";
import type { ProductCardData } from "@/lib/products/queries";
import { cn } from "@/lib/utils";

export function ProductGrid({ products }: { products: ProductCardData[] }) {
  const t = useTranslations("products");
  const [filter, setFilter] = useState<"all" | "favorites" | ProductLine>("all");
  const visible = useMemo(
    () =>
      products.filter((product) =>
        filter === "all"
          ? true
          : filter === "favorites"
            ? product.isFavorite
            : product.productLine === filter,
      ),
    [filter, products],
  );
  return (
    <Tabs
      className="gap-8"
      value={filter}
      onValueChange={(value) => setFilter(value as typeof filter)}
    >
      <TabsList>
        <TabsTrigger value="all">{t("filters.all")}</TabsTrigger>
        {PRODUCT_LINES.map((line) => (
          <TabsTrigger key={line} value={line}>
            {line}
          </TabsTrigger>
        ))}
        <TabsTrigger value="favorites">
          <Heart aria-hidden />
          {t("filters.favorites")}
        </TabsTrigger>
      </TabsList>
      {/* The filtered grid is the active tab's panel. */}
      <TabsContent value={filter}>
        <ul
          key={filter}
          className="fx-stagger grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
        >
          {visible.map((product, index) => (
            <li key={product.id} style={{ "--i": Math.min(index, 12) } as React.CSSProperties}>
              <ProductCard product={product} />
            </li>
          ))}
        </ul>
      </TabsContent>
    </Tabs>
  );
}

function ProductCard({ product }: { product: ProductCardData }) {
  const t = useTranslations("products");
  const [favorite, setFavorite] = useState(product.isFavorite);
  const [pending, startTransition] = useTransition();
  return (
    <article className="group relative">
      <Link href={`/products/${product.id}`} className="block rounded-(--radius-panel)">
        <div className="crop-marks relative aspect-[4/5] overflow-hidden rounded-(--radius-panel) stage">
          <StorageImage
            src={product.coverUrl}
            alt={product.name}
            fit="cover"
            className="size-full transition-transform duration-700 ease-(--ease-spring) group-hover:scale-[1.03]"
          />
          <div className="absolute start-5 top-5 z-[2]">
            <ProductLineBadge line={product.productLine} />
          </div>
        </div>
        <div className="flex items-start justify-between gap-4 px-1 pt-4">
          <div className="min-w-0">
            <h2 className="font-heading text-xl leading-tight">{product.name}</h2>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {t("pieces", { count: product.pieceCount })} · {product.pieceNames.join(" · ")}
            </p>
          </div>
          <ArrowUpRight
            className="mt-1 size-5 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent-ink rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
            aria-hidden
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-dashed border-border-strong px-1 pt-3">
          <StageSteps stage={product.stage} />
          <span className="inline-flex items-center gap-3 text-xs text-muted-foreground">
            <span>{t("photoCount", { count: product.photoCount })}</span>
            <span className="inline-flex items-center gap-1">
              <Palette className="size-3.5" aria-hidden />
              {t("colorwayCount", { count: product.colorwayCount })}
            </span>
          </span>
        </div>
      </Link>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const next = !favorite;
            setFavorite(next);
            const result = await setProductFavoriteAction(product.id, next);
            if (!result.ok) {
              setFavorite(!next);
              toast.error(result.error);
            }
          })
        }
        aria-pressed={favorite}
        aria-label={favorite ? t("unfavorite") : t("favorite")}
        className="absolute end-5 top-5 z-[3] grid size-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition-transform hover:scale-105"
      >
        <Heart className={cn("size-4", favorite && "fill-[#ff6a9a] text-[#ff6a9a]")} aria-hidden />
      </button>
    </article>
  );
}
