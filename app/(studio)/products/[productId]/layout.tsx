import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/common/page-header";
import { ProductLineBadge } from "@/components/products/product-line-badge";
import { ProductSubnav } from "@/components/products/product-subnav";
import { requireOwner } from "@/lib/auth/owner";

export default async function ProductLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const { supabase } = await requireOwner();
  const t = await getTranslations("products");
  const [{ data: product }, { data: pieces }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, product_line, piece_count")
      .eq("id", productId)
      .maybeSingle(),
    supabase.from("product_pieces").select("name").eq("product_id", productId).order("position"),
  ]);
  if (!product) notFound();
  return (
    <>
      <PageHeader
        eyebrow={<ProductLineBadge line={product.product_line} />}
        title={product.name}
        description={`${t("pieces", { count: product.piece_count })} · ${(pieces ?? []).map((piece) => piece.name).join(" · ")}`}
      />
      <ProductSubnav productId={product.id} />
      {children}
    </>
  );
}
