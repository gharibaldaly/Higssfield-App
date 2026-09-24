"use client";

import { Heart, Palette } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { StorageImage } from "@/components/generation/generation-media";
import { ProductLineBadge } from "@/components/products/product-line-badge";
import { StageSteps } from "@/components/products/stage-steps";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
    <div className="flex flex-col gap-6">
      <Tabs value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
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
      </Tabs>
      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {visible.map((product, index) => (
          <motion.li
            key={product.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index, 12) * 0.04 }}
          >
            <ProductCard product={product} />
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function ProductCard({ product }: { product: ProductCardData }) {
  const t = useTranslations("products");
  const [favorite, setFavorite] = useState(product.isFavorite);
  const [pending, startTransition] = useTransition();
  return (
    <Card className="group overflow-hidden transition-transform duration-300 ease-(--ease-spring) hover:-translate-y-1">
      <Link href={`/products/${product.id}`} className="block focus-visible:outline-none">
        <div className="relative aspect-[4/5] overflow-hidden rounded-t-(--radius-glass) bg-muted">
          <StorageImage
            src={product.coverUrl}
            alt={product.name}
            fit="cover"
            className="size-full transition-transform duration-700 group-hover:scale-[1.03]"
          />
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent" />
          <div className="absolute start-3 bottom-3">
            <ProductLineBadge line={product.productLine} />
          </div>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <div>
            <h3 className="font-display text-xl leading-tight font-semibold">{product.name}</h3>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {t("pieces", { count: product.pieceCount })} · {product.pieceNames.join(" · ")}
            </p>
          </div>
          <StageSteps stage={product.stage} />
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{t("photoCount", { count: product.photoCount })}</span>
            <span className="inline-flex items-center gap-1">
              <Palette className="size-3.5" aria-hidden />
              {t("colorwayCount", { count: product.colorwayCount })}
            </span>
          </div>
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
        className="absolute end-3 top-3 grid size-9 place-items-center rounded-full glass transition-transform hover:scale-105"
      >
        <Heart className={cn("size-4", favorite && "fill-rose text-rose")} aria-hidden />
      </button>
    </Card>
  );
}
