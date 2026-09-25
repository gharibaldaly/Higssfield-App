"use client";

import { AlertTriangle, BadgeCheck, Bot, FilePlus2, Loader2, Save, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { Field, StringListEditor } from "@/components/dna/list-editors";
import { PhotoRail } from "@/components/dna/photo-rail";
import { PieceEditor } from "@/components/dna/piece-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  analyzeGarmentAction,
  approveDnaAction,
  createManualDnaAction,
  saveDnaAction,
} from "@/lib/actions/dna";
import type { GarmentDna } from "@/lib/domain/garment-dna";
import type { PhotoView } from "@/lib/products/queries";
import { cn } from "@/lib/utils";

export type DnaVersionView = {
  id: string;
  version: number;
  status: "draft" | "approved" | "superseded";
  source: "llm" | "manual";
  llmProvider: string | null;
  llmModel: string | null;
  data: GarmentDna | null;
  createdAt: string;
};

export function DnaWorkbench({
  productId,
  pieces,
  photos,
  versions,
  selectedId,
  brain,
}: {
  productId: string;
  pieces: { id: string; name: string; position: number }[];
  photos: PhotoView[];
  versions: DnaVersionView[];
  selectedId: string | null;
  brain: { provider: string; model: string; mock: boolean };
}) {
  const t = useTranslations("dna");
  const router = useRouter();
  const selected = versions.find((version) => version.id === selectedId) ?? versions[0] ?? null;
  const [dna, setDna] = useState<GarmentDna | null>(selected?.data ?? null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "analyze" | "manual" | "save" | "approve">(null);
  const [, startTransition] = useTransition();

  // Switching versions always loads that version; a refresh of the same
  // version only replaces the form when there are no unsaved edits.
  const selectedKey = `${selected?.id ?? ""}:${JSON.stringify(selected?.data ?? null)}`;
  const [syncedKey, setSyncedKey] = useState(selectedKey);
  if (selectedKey !== syncedKey) {
    const switched = !syncedKey.startsWith(`${selected?.id ?? ""}:`);
    setSyncedKey(selectedKey);
    if (switched || !dirty) {
      setDna(selected?.data ?? null);
      setDirty(false);
    }
  }

  function update(next: GarmentDna) {
    setDna(next);
    setDirty(true);
  }

  function select(id: string) {
    if (dirty && !window.confirm(t("discardChanges"))) return;
    router.replace(`/products/${productId}/dna?v=${id}`, { scroll: false });
  }

  function run(kind: NonNullable<typeof busy>, action: () => Promise<void>) {
    setBusy(kind);
    startTransition(async () => {
      try {
        await action();
      } finally {
        setBusy(null);
      }
    });
  }

  const analyze = () =>
    run("analyze", async () => {
      const result = await analyzeGarmentAction(productId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("analyzed"));
      router.replace(`/products/${productId}/dna?v=${result.data.dnaId}`, { scroll: false });
      router.refresh();
    });

  const manual = () =>
    run("manual", async () => {
      const result = await createManualDnaAction(productId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.replace(`/products/${productId}/dna?v=${result.data.dnaId}`, { scroll: false });
      router.refresh();
    });

  async function save(): Promise<string | null> {
    if (!selected || !dna) return null;
    const result = await saveDnaAction(productId, selected.id, dna);
    if (!result.ok) {
      toast.error(result.error);
      return null;
    }
    setDirty(false);
    if (result.data.dnaId !== selected.id) {
      toast.success(t("savedAsNew", { version: result.data.version }));
      router.replace(`/products/${productId}/dna?v=${result.data.dnaId}`, { scroll: false });
    } else {
      toast.success(t("saved"));
    }
    router.refresh();
    return result.data.dnaId;
  }

  const approve = () =>
    run("approve", async () => {
      const id = dirty || selected?.status !== "draft" ? await save() : (selected?.id ?? null);
      if (!id) return;
      const result = await approveDnaAction(productId, id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("approved"));
      router.refresh();
    });

  const brainBadge = (
    <Badge variant={brain.mock ? "warning" : "champagne"}>
      <Bot aria-hidden />
      {brain.mock ? t("mockBrain") : `${brain.provider} · ${brain.model}`}
    </Badge>
  );

  if (versions.length === 0 || !selected) {
    return (
      <EmptyState
        icon={Sparkles}
        title={t("empty.title")}
        description={t("empty.description")}
        steps={[t("empty.step1"), t("empty.step2"), t("empty.step3")]}
        action={
          <div className="flex flex-col items-center gap-3">
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="lg" onClick={analyze} disabled={busy !== null || photos.length === 0}>
                {busy === "analyze" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Sparkles aria-hidden />
                )}
                {busy === "analyze" ? t("analyzing") : t("analyze")}
              </Button>
              <Button size="lg" variant="glass" onClick={manual} disabled={busy !== null}>
                <FilePlus2 aria-hidden />
                {t("manual")}
              </Button>
            </div>
            {brainBadge}
            {photos.length === 0 ? <p className="text-xs text-warning">{t("needPhotos")}</p> : null}
          </div>
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-1.5" role="list" aria-label={t("versions")}>
              {versions.map((version) => (
                <button
                  key={version.id}
                  type="button"
                  role="listitem"
                  onClick={() => select(version.id)}
                  aria-current={version.id === selected.id ? "true" : undefined}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                    version.id === selected.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:bg-muted",
                  )}
                >
                  v{version.version}
                  {version.status === "approved" ? (
                    <BadgeCheck className="size-3.5" aria-hidden />
                  ) : null}
                </button>
              ))}
            </div>
            <Badge
              variant={
                selected.status === "approved"
                  ? "success"
                  : selected.status === "draft"
                    ? "warning"
                    : "muted"
              }
            >
              {t(`status.${selected.status}`)}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {selected.source === "llm"
                ? t("byBrain", { model: selected.llmModel ?? "" })
                : t("byHand")}
            </span>
            <div className="ms-auto flex flex-wrap items-center gap-2">
              {brainBadge}
              <Button
                variant="glass"
                size="sm"
                onClick={analyze}
                disabled={busy !== null || photos.length === 0}
              >
                {busy === "analyze" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Sparkles aria-hidden />
                )}
                {busy === "analyze" ? t("analyzing") : t("reanalyze")}
              </Button>
            </div>
          </CardContent>
        </Card>

        {dna && dna.photoGaps.length > 0 ? (
          <Card className="border-warning/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <AlertTriangle className="size-5 text-warning" aria-hidden />
                {t("gapsTitle")}
              </CardTitle>
              <CardDescription>{t("gapsHint")}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1 ps-5 text-sm">
                {dna.photoGaps.map((gap, index) => (
                  <li key={index}>{gap}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {dna ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{t("summary")}</CardTitle>
                {selected.status !== "draft" ? (
                  <CardDescription>{t("editingApproved")}</CardDescription>
                ) : null}
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Field label={t("productSummary")}>
                  <Textarea
                    value={dna.productSummary}
                    onChange={(event) => update({ ...dna, productSummary: event.target.value })}
                  />
                </Field>
                {pieces.length > 1 ? (
                  <Field label={t("setComposition")}>
                    <Textarea
                      value={dna.setComposition}
                      onChange={(event) => update({ ...dna, setComposition: event.target.value })}
                    />
                  </Field>
                ) : null}
                <Field label={t("globalDoNotAlter")}>
                  <StringListEditor
                    items={dna.globalDoNotAlter}
                    onChange={(globalDoNotAlter) => update({ ...dna, globalDoNotAlter })}
                    addLabel={t("editor.addRule")}
                    placeholder={t("editor.rulePlaceholder")}
                  />
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Tabs defaultValue={String(dna.pieces[0]?.position ?? 1)}>
                  <TabsList>
                    {dna.pieces.map((piece) => (
                      <TabsTrigger key={piece.position} value={String(piece.position)}>
                        {piece.pieceName}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {dna.pieces.map((piece, index) => (
                    <TabsContent
                      key={piece.position}
                      value={String(piece.position)}
                      className="pt-4"
                    >
                      <PieceEditor
                        piece={piece}
                        onChange={(next) =>
                          update({
                            ...dna,
                            pieces: dna.pieces.map((value, i) => (i === index ? next : value)),
                          })
                        }
                      />
                    </TabsContent>
                  ))}
                </Tabs>
              </CardContent>
            </Card>

            <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-3 rounded-full p-2 ps-5 glass-strong">
              <p className="me-auto text-sm text-muted-foreground">
                {dirty
                  ? t("unsaved")
                  : selected.status === "approved"
                    ? t("isApproved")
                    : t("reviewHint")}
              </p>
              <Button
                variant="glass"
                onClick={() => run("save", async () => void (await save()))}
                disabled={busy !== null || !dirty}
              >
                {busy === "save" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Save aria-hidden />
                )}
                {t("save")}
              </Button>
              <Button
                onClick={approve}
                disabled={busy !== null || (selected.status === "approved" && !dirty)}
              >
                {busy === "approve" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <BadgeCheck aria-hidden />
                )}
                {t("approve")}
              </Button>
            </div>
          </>
        ) : (
          <Card>
            <CardContent className="text-sm text-destructive">{t("invalidData")}</CardContent>
          </Card>
        )}
      </div>

      <aside className="xl:sticky xl:top-24 xl:self-start">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("rail.title")}</CardTitle>
            <CardDescription>{t("rail.hint")}</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[70dvh] overflow-y-auto">
            <PhotoRail photos={photos} pieces={pieces} />
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
