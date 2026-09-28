"use client";

import { Images } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import { EmptyState } from "@/components/common/empty-state";
import { SectionTitle } from "@/components/common/page-header";
import { StorageImage } from "@/components/generation/generation-media";
import { ProductLineBadge } from "@/components/products/product-line-badge";
import { Badge } from "@/components/ui/badge";
import type { CollectionCard } from "@/lib/library/collections";
import { cn } from "@/lib/utils";

/** The library's results: every batch, then every product with results of its own. */
export function CollectionCards({
  batches,
  products,
}: {
  batches: CollectionCard[];
  products: CollectionCard[];
}) {
  const t = useTranslations("library.collections");
  if (batches.length === 0 && products.length === 0) {
    return (
      <EmptyState icon={Images} title={t("empty.title")} description={t("empty.description")} />
    );
  }
  return (
    <div className="flex flex-col gap-12">
      {batches.length > 0 ? (
        <section>
          <SectionTitle>{t("batches")}</SectionTitle>
          <ul className="fx-stagger mt-5 grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-3 xl:grid-cols-4">
            {batches.map((card, index) => (
              <CardItem key={card.id} card={card} index={index} />
            ))}
          </ul>
        </section>
      ) : null}
      {products.length > 0 ? (
        <section>
          <SectionTitle>{t("products")}</SectionTitle>
          <ul className="fx-stagger mt-5 grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-3 xl:grid-cols-5">
            {products.map((card, index) => (
              <CardItem key={card.id} card={card} index={index} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function CardItem({ card, index }: { card: CollectionCard; index: number }) {
  const t = useTranslations("library.collections");
  const format = useFormatter();
  const date = card.createdAt
    ? format.dateTime(new Date(card.createdAt), { dateStyle: "medium" })
    : "";
  return (
    <li style={{ "--i": Math.min(index, 12) } as React.CSSProperties}>
      <Link
        href={`/library/${card.kind}/${card.id}`}
        className="group block rounded-(--radius-panel) focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {/* Covers on the neutral stage: a batch shows its first models, a product its latest image. */}
        <div
          className={cn(
            "crop-marks relative grid aspect-[4/5] gap-1 overflow-hidden rounded-(--radius-panel) stage p-1",
            card.coverUrls.length > 1 ? "grid-cols-2 grid-rows-2" : "grid-cols-1",
          )}
        >
          {card.coverUrls.length === 0 ? (
            <div className="grid place-items-center text-muted-foreground">
              <Images className="size-7" aria-hidden />
            </div>
          ) : (
            card.coverUrls
              .slice(0, 4)
              .map((url, position) => (
                <StorageImage
                  key={url}
                  src={url}
                  alt={position === 0 ? card.name : ""}
                  className="size-full rounded-[6px] transition-transform duration-700 ease-(--ease-spring) group-hover:scale-[1.02]"
                />
              ))
          )}
        </div>
        <div className="flex flex-col items-start gap-1.5 px-1 pt-3">
          <p className="max-w-full truncate font-heading text-lg">{card.name}</p>
          <p className="hud text-muted-foreground">
            {card.kind === "batch" ? `${date} · ${t("models", { count: card.models })}` : date}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("images", { count: card.images })} · {t("approved", { count: card.approved })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {card.productLine ? <ProductLineBadge line={card.productLine} /> : null}
            {card.status === "paused" ? <Badge variant="muted">{t("paused")}</Badge> : null}
          </div>
        </div>
      </Link>
    </li>
  );
}
