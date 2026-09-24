"use client";

import { Ghost, Layers, Loader2, Palette, ScanEye, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { Elapsed } from "@/components/generation/elapsed";
import { ModelPicker } from "@/components/generation/model-picker";
import { useGenerationPolling } from "@/components/generation/use-generation-polling";
import { useSequentialRunner } from "@/components/generation/use-sequential-runner";
import { JobCard } from "@/components/ghost/job-card";
import { ProductChecklist } from "@/components/ghost/product-checklist";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/controls";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queueCatalogueJobsAction, runCatalogueJobAction } from "@/lib/actions/catalogue";
import type { GhostJob, GhostProduct } from "@/lib/catalogue/queries";
import type { CatalogueStyle } from "@/lib/domain/catalogue-style";
import type { ModelOption } from "@/lib/providers/higgsfield/options";
import { cn } from "@/lib/utils";

type JobType = "front_back" | "macro" | "colorways";

const JOB_TYPES: { value: JobType; icon: typeof Ghost }[] = [
  { value: "front_back", icon: Layers },
  { value: "macro", icon: ScanEye },
  { value: "colorways", icon: Palette },
];

export function GhostStudio({
  products,
  jobs,
  models,
  defaultModelId,
  style,
}: {
  products: GhostProduct[];
  jobs: GhostJob[];
  models: ModelOption[];
  defaultModelId: string | null;
  style: CatalogueStyle;
}) {
  const t = useTranslations("ghost");
  const router = useRouter();
  const [jobType, setJobType] = useState<JobType>("front_back");
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [selected, setSelected] = useState<string[]>(products[0] ? [products[0].id] : []);
  const [macroDetails, setMacroDetails] = useState<Record<string, string[]>>({});
  const [colorwayIds, setColorwayIds] = useState<Record<string, string[]>>({});
  const [modelId, setModelId] = useState<string | null>(defaultModelId);
  const [pending, startTransition] = useTransition();

  const { views } = useGenerationPolling(
    jobs.flatMap((job) => job.outputs.map((output) => output.generation)),
    { onSettled: () => router.refresh() },
  );

  const queued = useMemo(
    () =>
      jobs
        .filter((job) => job.status === "queued")
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        .map((job) => job.id),
    [jobs],
  );
  const runner = useSequentialRunner({
    queue: queued,
    run: async (jobId) => {
      const result = await runCatalogueJobAction(jobId);
      if (!result.ok) toast.error(result.error);
      router.refresh();
    },
  });

  if (products.length === 0) {
    return (
      <EmptyState
        icon={Ghost}
        title={t("empty.title")}
        description={t("empty.description")}
        action={
          <Button asChild>
            <Link href="/products/new">{t("empty.action")}</Link>
          </Button>
        }
      />
    );
  }

  const selectedProducts = products.filter((product) => selected.includes(product.id));

  function queueJobs() {
    startTransition(async () => {
      const result = await queueCatalogueJobsAction({
        jobTypes: [jobType],
        productIds: selected,
        modelId,
        macroDetails: jobType === "macro" ? macroDetails : undefined,
        colorwayIds: jobType === "colorways" ? colorwayIds : undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.data.jobIds.length > 0)
        toast.success(t("queued", { count: result.data.jobIds.length }));
      for (const skip of result.data.skipped) {
        const product = products.find((candidate) => candidate.id === skip.productId);
        toast.warning(`${product?.name ?? ""}: ${skip.reason}`);
      }
      router.refresh();
    });
  }

  const running = runner.current ? jobs.find((job) => job.id === runner.current) : null;

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-6 xl:sticky xl:top-24 xl:self-start">
        <Card>
          <CardHeader>
            <CardTitle>{t("setup.title")}</CardTitle>
            <CardDescription>{t("setup.hint")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Tabs value={jobType} onValueChange={(value) => setJobType(value as JobType)}>
              <TabsList className="w-full">
                {JOB_TYPES.map((item) => {
                  const Icon = item.icon;
                  return (
                    <TabsTrigger key={item.value} value={item.value} className="flex-1 px-3">
                      <Icon aria-hidden />
                      {t(`types.${item.value}.short`)}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
            <div className="rounded-2xl bg-muted p-4">
              <p className="text-sm font-medium">{t(`types.${jobType}.title`)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t(`types.${jobType}.description`)}
              </p>
            </div>

            <div className="inline-flex w-fit rounded-full p-1 glass">
              {(["single", "batch"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => {
                    setMode(value);
                    if (value === "single") setSelected((current) => current.slice(0, 1));
                  }}
                  className={cn(
                    "h-8 rounded-full px-4 text-xs font-medium transition-colors",
                    mode === value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`modes.${value}`)}
                </button>
              ))}
            </div>

            <ProductChecklist
              products={products}
              jobType={jobType}
              mode={mode}
              selected={selected}
              onSelectedChange={setSelected}
              macroDetails={macroDetails}
              onMacroDetailsChange={setMacroDetails}
              colorwayIds={colorwayIds}
              onColorwayIdsChange={setColorwayIds}
            />

            <ModelPicker
              models={models}
              value={modelId}
              onChange={setModelId}
              label={t("model")}
              id="ghost-model"
            />

            <div className="flex items-center gap-3 rounded-2xl bg-muted p-3 text-xs">
              <span
                className="size-8 shrink-0 rounded-lg border border-border"
                style={{ background: style.background }}
              />
              <span className="flex-1 text-muted-foreground">
                {t("style", { aspect: style.aspectRatio, padding: style.paddingPercent })}
              </span>
              <Link
                href="/settings"
                className="font-medium text-champagne-ink underline-offset-4 hover:underline"
              >
                {t("editStyle")}
              </Link>
            </div>

            <Button
              size="lg"
              onClick={queueJobs}
              disabled={pending || selectedProducts.length === 0 || !modelId}
            >
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Sparkles aria-hidden />
              )}
              {mode === "batch"
                ? t("queueBatch", { count: selectedProducts.length })
                : t("queueSingle")}
            </Button>
          </CardContent>
        </Card>
      </aside>

      <section className="flex min-w-0 flex-col gap-5" aria-label={t("queueTitle")}>
        {runner.current || runner.waiting.length > 0 ? (
          <Card className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <Loader2 className="size-5 animate-spin text-champagne-ink" aria-hidden />
              <p className="text-sm font-medium">
                {running
                  ? t("runner.running", {
                      product: running.productName,
                      type: t(`types.${running.jobType}.short`),
                    })
                  : t("runner.starting")}
              </p>
              <Badge variant="muted">{t("runner.waiting", { count: runner.waiting.length })}</Badge>
              <Elapsed since={runner.startedAt} className="ms-auto text-xs text-muted-foreground" />
            </div>
            <Progress indeterminate className="mt-3" aria-label={t("runner.progress")} />
          </Card>
        ) : null}
        {jobs.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title={t("noJobs.title")}
            description={t("noJobs.description")}
          />
        ) : (
          jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              views={views}
              queuePosition={runner.positionOf(job.id)}
              isRunning={runner.current === job.id}
            />
          ))
        )}
      </section>
    </div>
  );
}
