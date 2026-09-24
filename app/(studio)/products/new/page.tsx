import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/common/page-header";
import { NewProductForm } from "@/components/products/new-product-form";
import { requireOwner } from "@/lib/auth/owner";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("products.form");
  return { title: t("title") };
}

export default async function NewProductPage() {
  await requireOwner();
  const t = await getTranslations("products.form");
  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <NewProductForm />
    </>
  );
}
