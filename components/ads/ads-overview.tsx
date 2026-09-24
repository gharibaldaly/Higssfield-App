"use client";

import { Clapperboard, Film, Loader2, Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { SectionTitle } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createAdProjectAction,
  deletePresetAction,
  resetPresetAction,
} from "@/lib/actions/director";

type ProjectSummary = {
  id: string;
  name: string;
  productName: string;
  presetName: string | null;
  status: "draft" | "planned" | "generating" | "review" | "done";
  shotCount: number;
  readyCount: number;
  createdAt: string;
};

type PresetSummary = { id: string; name: string; description: string | null; isBuiltin: boolean };

export function AdsOverview({
  projects,
  products,
  presets,
}: {
  projects: ProjectSummary[];
  products: { id: string; name: string; ready: boolean }[];
  presets: PresetSummary[];
}) {
  const t = useTranslations("ads");
  const format = useFormatter();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const readyProducts = products.filter((product) => product.ready);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle>{t("projects")}</SectionTitle>
          <Button onClick={() => setOpen(true)} disabled={readyProducts.length === 0}>
            <Plus aria-hidden />
            {t("new")}
          </Button>
        </div>
        {readyProducts.length === 0 ? (
          <p className="text-sm text-warning">{t("needSheet")}</p>
        ) : null}
        {projects.length === 0 ? (
          <EmptyState
            icon={Clapperboard}
            title={t("empty.title")}
            description={t("empty.description")}
            steps={[t("empty.step1"), t("empty.step2"), t("empty.step3")]}
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <li key={project.id}>
                <Link href={`/ads/${project.id}`} className="block focus-visible:outline-none">
                  <Card className="h-full p-5 transition-transform duration-300 hover:-translate-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="grid size-11 place-items-center rounded-2xl bg-[linear-gradient(145deg,var(--color-wine-600),var(--color-wine))] text-cream">
                        <Film className="size-5" aria-hidden />
                      </div>
                      <Badge
                        variant={
                          project.status === "review" || project.status === "done"
                            ? "success"
                            : "muted"
                        }
                      >
                        {t(`status.${project.status}`)}
                      </Badge>
                    </div>
                    <h3 className="mt-4 font-display text-xl font-semibold">{project.name}</h3>
                    <p className="text-sm text-muted-foreground">{project.productName}</p>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {t("shotsReady", { ready: project.readyCount, total: project.shotCount })}
                      {project.presetName ? ` · ${project.presetName}` : ""}
                      {` · ${format.relativeTime(new Date(project.createdAt), new Date())}`}
                    </p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionTitle>{t("presets.title")}</SectionTitle>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("presets.hint")}</p>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {presets.map((preset) => (
            <li key={preset.id}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Sparkles className="size-4 text-champagne-ink" aria-hidden />
                    {preset.name}
                  </CardTitle>
                  <CardDescription>{preset.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {preset.isBuiltin ? (
                    <>
                      <Badge variant="champagne">{t("presets.builtin")}</Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => {
                          if (!window.confirm(t("presets.confirmReset"))) return;
                          startTransition(async () => {
                            const result = await resetPresetAction(preset.id);
                            if (!result.ok) toast.error(result.error);
                            else toast.success(t("presets.reset"));
                            router.refresh();
                          });
                        }}
                      >
                        <RotateCcw aria-hidden />
                        {t("presets.resetAction")}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={pending}
                      onClick={() => {
                        if (!window.confirm(t("presets.confirmDelete"))) return;
                        startTransition(async () => {
                          const result = await deletePresetAction(preset.id);
                          if (!result.ok) toast.error(result.error);
                          router.refresh();
                        });
                      }}
                    >
                      <Trash2 aria-hidden />
                      {t("presets.delete")}
                    </Button>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <NewAdDialog open={open} onOpenChange={setOpen} products={readyProducts} presets={presets} />
    </div>
  );
}

function NewAdDialog({
  open,
  onOpenChange,
  products,
  presets,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: { id: string; name: string }[];
  presets: PresetSummary[];
}) {
  const t = useTranslations("ads");
  const router = useRouter();
  const [productId, setProductId] = useState<string | undefined>(products[0]?.id);
  const [presetId, setPresetId] = useState<string | undefined>(
    presets.find((preset) => preset.isBuiltin)?.id ?? presets[0]?.id,
  );
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("new")}</DialogTitle>
          <DialogDescription>{t("newHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>{t("product")}</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger>
                <SelectValue placeholder={t("chooseProduct")} />
              </SelectTrigger>
              <SelectContent>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ad-name">{t("name")}</Label>
            <Input
              id="ad-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("namePlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("preset")}</Label>
            <Select value={presetId} onValueChange={setPresetId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ad-brief">{t("brief")}</Label>
            <Textarea
              id="ad-brief"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder={t("briefPlaceholder")}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !productId || !name.trim()}
            onClick={() =>
              startTransition(async () => {
                const result = await createAdProjectAction({
                  productId,
                  name,
                  presetId: presetId ?? null,
                  brief,
                });
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                router.push(`/ads/${result.data.id}`);
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
            {t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
