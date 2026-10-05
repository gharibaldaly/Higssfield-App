import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/common/empty-state";
import { FreeResultCard } from "@/components/free/free-result-card";
import type { FreeItem } from "@/lib/generations/free";

/**
 * A guest's free generations as the owner reads them: every result with its
 * prompt, references, model, size and cost, to look at and download. Nothing
 * can be changed from here (the rows and files belong to the guest), and the
 * page shows what the database holds when it opens; a pending request
 * settles when the guest's own page polls it.
 */
export function GuestHistory({ email, items }: { email: string; items: FreeItem[] }) {
  const t = useTranslations("free.history");
  if (items.length === 0) {
    return (
      <EmptyState icon={Sparkles} title={t("empty", { email })} description={t("emptyHint")} />
    );
  }
  return (
    <section aria-label={t("of", { email })} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("readOnly", { email })}</p>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {items.map((item) => (
          <FreeResultCard key={item.view.id} item={item} view={item.view} readOnly />
        ))}
      </ul>
    </section>
  );
}
