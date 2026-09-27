"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { BatchBoard } from "@/components/ghost-batch/batch-board";
import { BatchIntake } from "@/components/ghost-batch/batch-intake";
import { Button } from "@/components/ui/button";
import type { CatalogueStyle } from "@/lib/domain/catalogue-style";
import type { GhostBatchDetail, GhostBatchSummary } from "@/lib/ghost-batches/queries";
import type { ModelOption } from "@/lib/providers/higgsfield/options";
import { cn } from "@/lib/utils";

/**
 * Ghost images straight from photos: drop the photos of many models, and the
 * studio works through them one by one — front, back and close-ups for every
 * model, then colours once the owner approves.
 */
export function GhostBatchStudio({
  batches,
  detail,
  models,
  defaultModelId,
  style,
  ownerId,
}: {
  batches: GhostBatchSummary[];
  detail: GhostBatchDetail | null;
  models: ModelOption[];
  defaultModelId: string | null;
  style: CatalogueStyle;
  ownerId: string;
}) {
  const t = useTranslations("ghostBatch.list");
  const [intake, setIntake] = useState<{ target: { id: string; name: string } | null } | null>(
    batches.length === 0 ? { target: null } : null,
  );

  return (
    <div className="flex flex-col gap-6">
      {batches.length > 0 ? (
        <nav aria-label={t("title")} className="flex items-stretch gap-3 overflow-x-auto pb-1">
          {batches.map((batch) => {
            const selected = !intake && detail?.id === batch.id;
            return (
              <Link
                key={batch.id}
                href={`/ghost?batch=${batch.id}`}
                aria-current={selected ? "page" : undefined}
                onClick={() => setIntake(null)}
                className={cn(
                  "flex min-w-44 shrink-0 flex-col gap-1 rounded-(--radius-control) border px-4 py-3 text-start transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  selected
                    ? "border-primary bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]"
                    : "border-border hover:border-border-strong",
                )}
              >
                <span className="max-w-56 truncate text-sm font-medium">{batch.name}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 rounded-full",
                      batch.status === "paused" ? "bg-muted-foreground" : "bg-success",
                    )}
                  />
                  <span dir="ltr">
                    {t("finished", { done: batch.finished, total: batch.total })}
                  </span>
                  {batch.status === "paused" ? <span>· {t("paused")}</span> : null}
                  {batch.failed > 0 ? (
                    <span className="text-warning">· {t("failed", { count: batch.failed })}</span>
                  ) : null}
                </span>
              </Link>
            );
          })}
          <Button
            variant={intake && !intake.target ? "default" : "surface"}
            className="h-auto min-h-14 shrink-0 rounded-(--radius-control)"
            onClick={() => setIntake({ target: null })}
          >
            <Plus aria-hidden />
            {t("new")}
          </Button>
        </nav>
      ) : null}

      {intake ? (
        <BatchIntake
          key={intake.target?.id ?? "new"}
          ownerId={ownerId}
          models={models}
          defaultModelId={defaultModelId}
          style={style}
          target={intake.target}
          onCancel={batches.length > 0 ? () => setIntake(null) : undefined}
        />
      ) : detail ? (
        <BatchBoard
          detail={detail}
          ownerId={ownerId}
          onAddModels={() => setIntake({ target: { id: detail.id, name: detail.name } })}
        />
      ) : null}
    </div>
  );
}
