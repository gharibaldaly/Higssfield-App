"use client";

import { Images } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/common/empty-state";
import { StorageImage } from "@/components/generation/generation-media";
import { CollectionCards } from "@/components/library/collection-cards";
import { ProductLineBadge } from "@/components/products/product-line-badge";
import { StageSteps } from "@/components/products/stage-steps";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProductStage, ProductLine } from "@/lib/domain/product";
import type { CollectionCard } from "@/lib/library/collections";

const TABS = ["generations", "products", "dna", "sheets", "colorways"] as const;

export function LibraryView({
  tab,
  collections,
  products,
  dna,
  sheets,
  colorways,
}: {
  tab: string;
  collections: { batches: CollectionCard[]; products: CollectionCard[] };
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
    <Tabs
      className="gap-6"
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

      {/* The active tab's panel; its trigger's aria-controls points here. */}
      <TabsContent value={active} className="flex flex-col gap-6">
        {active === "generations" ? <CollectionCards {...collections} /> : null}

        {active === "products" ? (
          products.length === 0 ? (
            <EmptyState
              icon={Images}
              title={t("empty.title")}
              description={t("empty.description")}
            />
          ) : (
            <ul className="grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-3 xl:grid-cols-5">
              {products.map((product) => (
                <li key={product.id}>
                  <Link
                    href={`/products/${product.id}`}
                    className="group block rounded-(--radius-panel)"
                  >
                    <div className="crop-marks relative overflow-hidden rounded-(--radius-panel) stage">
                      <StorageImage
                        src={product.coverUrl}
                        alt={product.name}
                        fit="cover"
                        className="aspect-[4/5] w-full transition-transform duration-700 ease-(--ease-spring) group-hover:scale-[1.03]"
                      />
                    </div>
                    <div className="flex flex-col items-start gap-2 px-1 pt-3">
                      <p className="max-w-full truncate font-heading text-lg">{product.name}</p>
                      <ProductLineBadge line={product.productLine} />
                      <StageSteps stage={product.stage} />
                    </div>
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
                <tr className="text-start hud text-muted-foreground">
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
                    <td className="px-3 py-2 font-mono text-xs" dir="ltr">
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
                <Link
                  href={`/products/${sheet.productId}/sheet?s=${sheet.id}`}
                  className="block rounded-(--radius-panel)"
                >
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
                <Link
                  href={`/products/${colorway.productId}/colorways`}
                  className="block rounded-(--radius-panel)"
                >
                  <Card className="overflow-hidden">
                    <div className="flex h-28 gap-2 stage p-3">
                      <div
                        className="flex-1 rounded-[3px] shadow-[0_1px_2px_rgba(0,0,0,0.3)] pinked"
                        style={{ background: colorway.hex }}
                      />
                      {colorway.swatchUrl ? (
                        <StorageImage
                          src={colorway.swatchUrl}
                          alt={colorway.name}
                          fit="cover"
                          className="w-2/5 rounded-[3px] pinked"
                        />
                      ) : null}
                    </div>
                    <div className="p-3 text-sm">
                      <p className="truncate font-medium">{colorway.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {colorway.productName}
                      </p>
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
      </TabsContent>
    </Tabs>
  );
}
