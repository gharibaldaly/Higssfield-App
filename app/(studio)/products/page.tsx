import { Plus, Shirt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ProductGrid } from "@/components/products/product-grid";
import { Button } from "@/components/ui/button";
import { requireOwner } from "@/lib/auth/owner";
import { listProductCards } from "@/lib/products/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("products");
  return { title: t("title") };
}

export default async function ProductsPage() {
  const { supabase } = await requireOwner();
  const t = await getTranslations("products");
  const products = await listProductCards(supabase);
  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          <Button asChild>
            <Link href="/products/new">
              <Plus aria-hidden />
              {t("new")}
            </Link>
          </Button>
        }
      />
      {products.length === 0 ? (
        <EmptyState
          icon={Shirt}
          title={t("empty.title")}
          description={t("empty.description")}
          steps={[t("empty.step1"), t("empty.step2"), t("empty.step3")]}
          action={
            <Button asChild>
              <Link href="/products/new">
                <Plus aria-hidden />
                {t("new")}
              </Link>
            </Button>
          }
        />
      ) : (
        <ProductGrid products={products} />
      )}
    </>
  );
}
