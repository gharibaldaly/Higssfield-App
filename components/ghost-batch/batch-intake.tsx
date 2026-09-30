"use client";

import {
  AlertTriangle,
  FolderOpen,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { wakeGhostRunner } from "@/components/ghost-batch/runner-store";
import { ModelPicker } from "@/components/generation/model-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createGhostBatchAction, registerBatchItemPhotosAction } from "@/lib/actions/ghost-batches";
import {
  filesFromDrop,
  filesFromInput,
  makeThumbnail,
  runPool,
  type PickedFile,
} from "@/lib/client/picked-files";
import { extensionForType, isAcceptedPhoto, uploadToStudio } from "@/lib/client/upload";
import type { CatalogueStyle } from "@/lib/domain/catalogue-style";
import { PRODUCT_LINES, type ProductLine } from "@/lib/domain/product";
import {
  DEFAULT_PHOTOS_PER_MODEL,
  INTAKE_LAYERS,
  INTAKE_TAGS,
  MAX_COLOUR_PHOTOS_PER_MODEL,
  MAX_GARMENT_PHOTOS_PER_MODEL,
  MAX_MODELS_PER_BATCH,
  planIntake,
  type IntakeGrouping,
  type IntakeTag,
  type PhotosPerModel,
  type TagSource,
} from "@/lib/ghost-batches/intake";
import type { PhotoLayer } from "@/lib/ghost-batches/schemas";
import type { ModelOption } from "@/lib/providers/higgsfield/options";
import { cn } from "@/lib/utils";

type LocalFile = { id: string; file: File; path: string; thumb: string | null };

type PhotoDraft = {
  fileId: string;
  tag: IntakeTag;
  tagSource: TagSource;
  colourName: string;
  /** For a robe set: the robe is in the photo, or the garment is shown without it. */
  layer: PhotoLayer;
  layerSource: "name" | "auto" | "manual";
};

type ModelDraft = {
  key: string;
  name: string;
  productLine: ProductLine;
  /** A robe set: two fronts (with and without the robe); colours from the one with it. */
  robe: boolean;
  photos: PhotoDraft[];
};

type UploadState = {
  done: number;
  total: number;
  failed: number;
  modelIndex: number;
  modelName: string;
};

const TAG_STYLE: Record<IntakeTag, string> = {
  front: "bg-primary text-primary-foreground",
  back: "bg-secondary text-secondary-foreground",
  detail: "bg-muted text-foreground",
  colour: "bg-[#ffb8cb] text-[#2a0714]",
};

const LAYER_STYLE: Record<PhotoLayer, string> = {
  outer: "border-primary text-foreground",
  inner: "border-border-strong text-foreground",
  auto: "border-dashed border-border-strong text-muted-foreground",
};

const UPLOAD_ATTEMPTS = 3;

async function uploadWithRetry(path: string, file: File): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await uploadToStudio(path, file, file.type);
      return;
    } catch (error) {
      if (attempt >= UPLOAD_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
}

const TAG_ORDER: Record<IntakeTag, number> = { front: 0, back: 1, detail: 2, colour: 3 };

/** The same file picked twice has the same name, size and date. */
function fileSignature(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

/** Photos show front, back, details, then colours, whatever order the files came in. */
function byTag(a: PhotoDraft, b: PhotoDraft): number {
  return TAG_ORDER[a.tag] - TAG_ORDER[b.tag];
}

function garmentOf(model: ModelDraft) {
  return model.photos.filter((photo) => photo.tag !== "colour");
}

function coloursOf(model: ModelDraft) {
  return model.photos.filter((photo) => photo.tag === "colour");
}

function overLimit(model: ModelDraft) {
  return (
    garmentOf(model).length > MAX_GARMENT_PHOTOS_PER_MODEL ||
    coloursOf(model).length > MAX_COLOUR_PHOTOS_PER_MODEL
  );
}

/** A drop's models join the list; a folder or name dropped again adds to its model. */
function mergeDrop(
  current: ModelDraft[],
  incoming: ModelDraft[],
  grouping: IntakeGrouping,
): ModelDraft[] {
  const merged = [...current];
  for (const model of incoming) {
    const index = merged.findIndex(
      (candidate) => candidate.name.toLowerCase() === model.name.toLowerCase(),
    );
    if (index >= 0 && grouping !== "sequence") {
      merged[index] = {
        ...merged[index]!,
        robe: merged[index]!.robe || model.robe,
        photos: [...merged[index]!.photos, ...model.photos],
      };
    } else {
      merged.push(model);
    }
  }
  return merged;
}

const PER_MODEL_CHOICES: PhotosPerModel[] = [
  "all",
  ...Array.from({ length: MAX_GARMENT_PHOTOS_PER_MODEL }, (_, index) => index + 1),
];

/**
 * Drop the photos of one garment model, or of many at once. Each drop is one
 * model unless its folders or file names clearly name several; the owner can
 * split, merge and re-tag before anything is uploaded. Photos then go straight
 * to Storage model by model, and each model reaches the batch runner as soon
 * as its photos are in.
 */
export function BatchIntake({
  ownerId,
  models,
  defaultModelId,
  style,
  target,
  onCancel,
}: {
  ownerId: string;
  models: ModelOption[];
  defaultModelId: string | null;
  style: CatalogueStyle;
  /** Adds the models to this batch instead of starting a new one. */
  target?: { id: string; name: string } | null;
  onCancel?: () => void;
}) {
  const t = useTranslations("ghostBatch.intake");
  const tLines = useTranslations("products.lines");
  const format = useFormatter();
  const router = useRouter();
  const folderInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Map<string, LocalFile>>(() => new Map());
  // The file ids of each drop, in order: every drop is planned on its own.
  const [drops, setDrops] = useState<string[][]>([]);
  const [drafts, setDrafts] = useState<ModelDraft[]>([]);
  const [grouping, setGrouping] = useState<IntakeGrouping>("names");
  const [perModel, setPerModel] = useState<PhotosPerModel>(DEFAULT_PHOTOS_PER_MODEL);
  const [rejected, setRejected] = useState(0);
  const [duplicates, setDuplicates] = useState(0);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [name, setName] = useState(() =>
    t("defaultName", { date: format.dateTime(new Date(), { day: "numeric", month: "short" }) }),
  );
  const [line, setLine] = useState<ProductLine>("SECRET");
  const [modelId, setModelId] = useState<string | null>(defaultModelId);
  const [dnaCheck, setDnaCheck] = useState<"auto" | "review">("auto");
  const [fidelity, setFidelity] = useState(true);
  const [upload, setUpload] = useState<UploadState | null>(null);

  // Object URLs of the thumbnails are released when the page goes away.
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  const draftsRef = useRef(drafts);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);
  useEffect(
    () => () => {
      for (const local of filesRef.current.values()) {
        if (local.thumb) URL.revokeObjectURL(local.thumb);
      }
    },
    [],
  );

  // Leaving mid-upload would strand the models that are not uploaded yet.
  useEffect(() => {
    if (!upload) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [upload]);

  function toDrafts(plan: ReturnType<typeof planIntake>, startNumber: number): ModelDraft[] {
    return plan.models.map((model, index) => {
      // Unnamed colours are numbered per model: Colour 1, Colour 2…
      let colourNumber = 0;
      return {
        key: `${model.key}-${startNumber + index}`,
        name: model.name.startsWith("#")
          ? t("sequenceName", { number: startNumber + index + 1 })
          : model.name,
        productLine: line,
        robe: model.robe,
        photos: model.photos.map((photo) => ({
          fileId: photo.fileId,
          tag: photo.tag,
          tagSource: photo.tagSource,
          colourName:
            photo.tag === "colour"
              ? (photo.colourName ?? t("colourDefault", { number: (colourNumber += 1) }))
              : "",
          layer: photo.layer ?? "auto",
          layerSource: photo.layer ? "name" : "auto",
        })),
      };
    });
  }

  async function addFiles(picked: PickedFile[]) {
    const skipped = picked.filter(
      ({ file }) =>
        !isAcceptedPhoto(file) && !file.name.startsWith(".") && file.name !== "Thumbs.db",
    ).length;
    setRejected((count) => count + skipped);
    // A photo already in a model (dropped twice, or by folder and by name) is skipped.
    const inUse = new Set(
      draftsRef.current.flatMap((model) => model.photos.map((photo) => photo.fileId)),
    );
    const known = new Set(
      [...filesRef.current.values()]
        .filter((local) => inUse.has(local.id))
        .map((local) => fileSignature(local.file)),
    );
    const accepted = picked.filter(({ file }) => {
      if (!isAcceptedPhoto(file)) return false;
      const signature = fileSignature(file);
      if (known.has(signature)) return false;
      known.add(signature);
      return true;
    });
    const repeated = picked.filter(({ file }) => isAcceptedPhoto(file)).length - accepted.length;
    if (repeated > 0) setDuplicates((count) => count + repeated);
    if (accepted.length === 0) return;
    const added: LocalFile[] = accepted.map(({ file, path }) => ({
      id: crypto.randomUUID(),
      file,
      path,
      thumb: null,
    }));
    const plan = planIntake(
      added.map((local) => ({ id: local.id, name: local.file.name, path: local.path })),
      { perModel },
    );
    setGrouping(plan.grouping);
    setFiles((current) => {
      const next = new Map(current);
      for (const local of added) next.set(local.id, local);
      return next;
    });
    setDrops((current) => [...current, added.map((local) => local.id)]);
    setDrafts((current) => mergeDrop(current, toDrafts(plan, current.length), plan.grouping));
    // Thumbnails, two at a time, so a hundred phone photos never decode at full size at once.
    await runPool(added, 2, async (local) => {
      const thumb = await makeThumbnail(local.file);
      setFiles((current) => {
        const entry = current.get(local.id);
        if (!entry) {
          if (thumb) URL.revokeObjectURL(thumb);
          return current;
        }
        return new Map(current).set(local.id, { ...entry, thumb });
      });
    });
  }

  /** Plans every drop again with a new split; removed photos stay out, manual tags stay. */
  function regroup(nextPerModel: PhotosPerModel) {
    setPerModel(nextPerModel);
    const kept = new Map(
      drafts.flatMap((model) => model.photos.map((photo) => [photo.fileId, photo] as const)),
    );
    let next: ModelDraft[] = [];
    let lastGrouping: IntakeGrouping = grouping;
    for (const drop of drops) {
      const locals = drop.flatMap((id) => {
        const local = files.get(id);
        return local && kept.has(id) ? [local] : [];
      });
      if (locals.length === 0) continue;
      const plan = planIntake(
        locals.map((local) => ({ id: local.id, name: local.file.name, path: local.path })),
        { perModel: nextPerModel },
      );
      lastGrouping = plan.grouping;
      next = mergeDrop(next, toDrafts(plan, next.length), plan.grouping);
    }
    setGrouping(lastGrouping);
    setDrafts(
      next.map((model) => ({
        ...model,
        photos: model.photos.map((photo) => {
          const before = kept.get(photo.fileId);
          const kept_ = before?.tagSource === "manual" ? { ...before } : { ...photo };
          if (before?.layerSource === "manual") {
            kept_.layer = before.layer;
            kept_.layerSource = "manual";
          }
          return kept_;
        }),
      })),
    );
  }

  function clearAll() {
    for (const local of files.values()) if (local.thumb) URL.revokeObjectURL(local.thumb);
    setFiles(new Map());
    setDrops([]);
    setDrafts([]);
    setRejected(0);
    setDuplicates(0);
  }

  function updateModel(index: number, patch: Partial<ModelDraft>) {
    setDrafts((current) =>
      current.map((model, position) => (position === index ? { ...model, ...patch } : model)),
    );
  }

  function updatePhoto(modelIndex: number, fileId: string, patch: Partial<PhotoDraft>) {
    setDrafts((current) =>
      current.map((model, position) =>
        position === modelIndex
          ? {
              ...model,
              photos: model.photos.map((photo) =>
                photo.fileId === fileId ? { ...photo, ...patch } : photo,
              ),
            }
          : model,
      ),
    );
  }

  function setTag(modelIndex: number, fileId: string, tag: IntakeTag) {
    const model = drafts[modelIndex];
    const colours = model ? coloursOf(model).length : 0;
    updatePhoto(modelIndex, fileId, {
      tag,
      tagSource: "manual",
      ...(tag === "colour" ? { colourName: t("colourDefault", { number: colours + 1 }) } : {}),
    });
  }

  function setLayer(modelIndex: number, fileId: string, layer: PhotoLayer) {
    updatePhoto(modelIndex, fileId, { layer, layerSource: layer === "auto" ? "auto" : "manual" });
  }

  function movePhoto(modelIndex: number, fileId: string, direction: -1 | 1) {
    setDrafts((current) => {
      const target = modelIndex + direction;
      const source = current[modelIndex];
      const photo = source?.photos.find((candidate) => candidate.fileId === fileId);
      if (!source || !photo || !current[target]) return current;
      return current
        .map((model, position) => {
          if (position === modelIndex) {
            return { ...model, photos: model.photos.filter((p) => p.fileId !== fileId) };
          }
          if (position === target) return { ...model, photos: [...model.photos, photo] };
          return model;
        })
        .filter((model) => model.photos.length > 0);
    });
  }

  /** Starts a new model, right after this one, with the photo. */
  function splitPhoto(modelIndex: number, fileId: string) {
    setDrafts((current) => {
      const source = current[modelIndex];
      const photo = source?.photos.find((candidate) => candidate.fileId === fileId);
      if (!source || !photo || source.photos.length < 2) return current;
      const next = [...current];
      next[modelIndex] = {
        ...source,
        photos: source.photos.filter((candidate) => candidate.fileId !== fileId),
      };
      const names = new Set(current.map((model) => model.name.toLowerCase()));
      let number = current.length + 1;
      while (names.has(t("sequenceName", { number }).toLowerCase())) number += 1;
      next.splice(modelIndex + 1, 0, {
        key: `split-${crypto.randomUUID()}`,
        name: t("sequenceName", { number }),
        productLine: source.productLine,
        robe: source.robe,
        photos: [photo],
      });
      return next;
    });
  }

  function removePhoto(modelIndex: number, fileId: string) {
    setDrafts((current) =>
      current
        .map((model, position) =>
          position === modelIndex
            ? { ...model, photos: model.photos.filter((photo) => photo.fileId !== fileId) }
            : model,
        )
        .filter((model) => model.photos.length > 0),
    );
  }

  function mergeUp(modelIndex: number) {
    setDrafts((current) => {
      if (modelIndex === 0) return current;
      const merged = [...current];
      const [model] = merged.splice(modelIndex, 1);
      merged[modelIndex - 1] = {
        ...merged[modelIndex - 1]!,
        photos: [...merged[modelIndex - 1]!.photos, ...model!.photos],
      };
      return merged;
    });
  }

  function removeModel(modelIndex: number) {
    setDrafts((current) => current.filter((_, position) => position !== modelIndex));
  }

  const totals = useMemo(
    () => ({
      photos: drafts.reduce(
        (sum, model) =>
          sum +
          Math.min(garmentOf(model).length, MAX_GARMENT_PHOTOS_PER_MODEL) +
          Math.min(coloursOf(model).length, MAX_COLOUR_PHOTOS_PER_MODEL),
        0,
      ),
      invalid: drafts.filter((model) => garmentOf(model).length === 0).length,
      overLimit: drafts.filter(overLimit).length,
    }),
    [drafts],
  );
  const tooManyModels = drafts.length > MAX_MODELS_PER_BATCH;
  const canStart =
    drafts.length > 0 &&
    totals.invalid === 0 &&
    totals.overLimit === 0 &&
    !tooManyModels &&
    Boolean(modelId || target) &&
    name.trim().length > 0 &&
    drafts.every((model) => model.name.trim().length > 0) &&
    !upload;

  async function start() {
    if (!canStart) return;
    const created = await createGhostBatchAction({
      batchId: target?.id ?? null,
      name: name.trim(),
      modelId: modelId ?? "unused",
      options: { dnaCheck, fidelityCheck: fidelity },
      models: drafts.map((model) => ({
        name: model.name.trim(),
        productLine: model.productLine,
        robe: model.robe,
      })),
    });
    if (!created.ok) {
      toast.error(created.error);
      return;
    }
    const { batchId, items } = created.data;
    const state: UploadState = {
      done: 0,
      total: totals.photos,
      failed: 0,
      modelIndex: 0,
      modelName: "",
    };
    setUpload({ ...state });
    let woke = false;
    for (const [index, model] of drafts.entries()) {
      const item = items[index];
      if (!item) continue;
      state.modelIndex = index + 1;
      state.modelName = model.name;
      setUpload({ ...state });
      const garment = garmentOf(model).slice(0, MAX_GARMENT_PHOTOS_PER_MODEL);
      const colours = coloursOf(model).slice(0, MAX_COLOUR_PHOTOS_PER_MODEL);
      const uploaded = await runPool([...garment, ...colours], 4, async (photo) => {
        const local = files.get(photo.fileId);
        if (!local) throw new Error("missing file");
        const folder = photo.tag === "colour" ? "swatches" : "sources";
        const path = `${ownerId}/products/${item.productId}/${folder}/${crypto.randomUUID()}.${extensionForType(local.file.type)}`;
        try {
          await uploadWithRetry(path, local.file);
        } finally {
          state.done += 1;
          setUpload({ ...state });
        }
        return { photo, path, file: local.file };
      });
      const succeeded = uploaded.flatMap((result) => (result.ok ? [result.value] : []));
      const failed = uploaded.length - succeeded.length;
      state.failed += failed;
      const registered = await registerBatchItemPhotosAction({
        itemId: item.itemId,
        photos: succeeded
          .filter(({ photo }) => photo.tag !== "colour")
          .map(({ photo, path, file }) => ({
            storagePath: path,
            mimeType: file.type,
            sizeBytes: file.size,
            kind: photo.tag as "front" | "back" | "detail",
            tagSource: photo.tagSource,
            // Only a robe set keeps its layers apart.
            layer: model.robe ? photo.layer : "inner",
          })),
        swatches: succeeded
          .filter(({ photo }) => photo.tag === "colour")
          .map(({ photo, path, file }) => ({
            storagePath: path,
            mimeType: file.type,
            sizeBytes: file.size,
            name: photo.colourName.trim() || t("colourDefault", { number: 1 }),
          })),
        failedUploads: failed,
      });
      if (!registered.ok) toast.error(`${model.name}: ${registered.error}`);
      if (!woke) {
        // Work on the first models starts while the rest are still uploading.
        wakeGhostRunner();
        woke = true;
      }
    }
    setUpload(null);
    if (state.failed > 0) toast.warning(t("uploadFailed", { count: state.failed }));
    toast.success(t("started"));
    clearAll();
    router.push(`/ghost?batch=${batchId}`);
    router.refresh();
  }

  const whiteStyle = style.background.toUpperCase() === "#FFFFFF";

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="flex min-w-0 flex-col gap-5" aria-label={t("title")}>
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (upload) return;
            setReading(true);
            filesFromDrop(event.dataTransfer)
              .then(addFiles)
              .finally(() => setReading(false));
          }}
          className={cn(
            "relative flex flex-col items-center justify-center gap-4 overflow-hidden rounded-(--radius-panel) border border-dashed border-border-strong px-6 text-center transition-colors",
            // A cutting mat: a fine grid the garments are laid out on.
            "bg-[linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] bg-[size:28px_28px]",
            drafts.length > 0 ? "py-8" : "py-16",
            dragging && "border-ring bg-highlight",
          )}
        >
          <p className="hud text-muted-foreground">
            {target ? t("addTitle", { name: target.name }) : t("title")}
          </p>
          <p className="font-heading text-3xl text-balance-safe sm:text-4xl">
            {reading ? t("reading") : dragging ? t("dropActive") : t("drop")}
          </p>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{t("hint")}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button
              variant="surface"
              onClick={() => folderInput.current?.click()}
              disabled={Boolean(upload) || reading}
            >
              <FolderOpen aria-hidden />
              {t("chooseFolder")}
            </Button>
            <Button
              variant="surface"
              onClick={() => photoInput.current?.click()}
              disabled={Boolean(upload) || reading}
            >
              <ImagePlus aria-hidden />
              {t("choosePhotos")}
            </Button>
          </div>
          <input
            ref={folderInput}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            // Folder picking is non-standard but supported by every current browser.
            {...({ webkitdirectory: "" } as Record<string, string>)}
            onChange={(event) => {
              void addFiles(filesFromInput(event.target.files));
              event.target.value = "";
            }}
          />
          <input
            ref={photoInput}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              void addFiles(filesFromInput(event.target.files));
              event.target.value = "";
            }}
          />
        </div>

        {rejected > 0 ? (
          <p className="flex items-start gap-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t("rejected", { count: rejected })}
          </p>
        ) : null}
        {duplicates > 0 ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t("duplicates", { count: duplicates })}
          </p>
        ) : null}

        {drafts.length > 0 ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-medium">
                {t("summary", { models: drafts.length, photos: totals.photos })}
              </p>
              <Badge variant="muted">
                {grouping === "sequence" && perModel === "all"
                  ? t("grouping.drop")
                  : t(`grouping.${grouping}`)}
              </Badge>
              {grouping === "sequence" ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground" id="batch-per-model">
                    {t("perModel")}
                  </span>
                  <Select
                    value={String(perModel)}
                    onValueChange={(value) => regroup(value === "all" ? "all" : Number(value))}
                    disabled={Boolean(upload)}
                  >
                    <SelectTrigger
                      className="h-8 w-auto min-w-40"
                      aria-labelledby="batch-per-model"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PER_MODEL_CHOICES.map((choice) => (
                        <SelectItem key={choice} value={String(choice)}>
                          {choice === "all"
                            ? t("perModelAll")
                            : t("perModelEvery", { count: choice })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="ms-auto"
                onClick={clearAll}
                disabled={Boolean(upload)}
              >
                <Trash2 aria-hidden />
                {t("clear")}
              </Button>
            </div>
            {grouping === "sequence" ? (
              <p className="text-sm text-muted-foreground">{t("perModelHint")}</p>
            ) : null}
            {tooManyModels ? (
              <p className="text-sm text-destructive">
                {t("tooManyModels", { max: MAX_MODELS_PER_BATCH })}
              </p>
            ) : null}
            {totals.overLimit > 0 ? (
              <p className="text-sm text-destructive">
                {t("overLimit", {
                  photos: MAX_GARMENT_PHOTOS_PER_MODEL,
                  colours: MAX_COLOUR_PHOTOS_PER_MODEL,
                })}
              </p>
            ) : null}

            <ol className="flex flex-col gap-3">
              {drafts.map((model, modelIndex) => {
                const garment = garmentOf(model);
                return (
                  <li
                    key={model.key}
                    className={cn(
                      "rounded-(--radius-panel) p-4 surface",
                      (garment.length === 0 || overLimit(model)) && "surface-warning",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="w-8 hud text-muted-foreground" dir="ltr">
                        {String(modelIndex + 1).padStart(2, "0")}
                      </span>
                      <Input
                        value={model.name}
                        onChange={(event) => updateModel(modelIndex, { name: event.target.value })}
                        aria-label={t("modelName")}
                        maxLength={200}
                        className="h-9 max-w-xs flex-1"
                        disabled={Boolean(upload)}
                      />
                      <Select
                        value={model.productLine}
                        onValueChange={(value) =>
                          updateModel(modelIndex, { productLine: value as ProductLine })
                        }
                        disabled={Boolean(upload)}
                      >
                        <SelectTrigger className="h-9 w-auto min-w-40" aria-label={t("line")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRODUCT_LINES.map((value) => (
                            <SelectItem key={value} value={value}>
                              {value} · {tLines(value)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <label className="flex items-center gap-2 text-xs" title={t("robeHint")}>
                        <Switch
                          checked={model.robe}
                          onCheckedChange={(checked) =>
                            updateModel(modelIndex, { robe: checked === true })
                          }
                          disabled={Boolean(upload)}
                          aria-label={t("robe")}
                        />
                        <span className="font-medium">{t("robe")}</span>
                      </label>
                      {garment.length === 0 ? (
                        <Badge variant="danger">{t("noGarment")}</Badge>
                      ) : garment.length > MAX_GARMENT_PHOTOS_PER_MODEL ? (
                        <Badge variant="danger">
                          {t("tooMany", { max: MAX_GARMENT_PHOTOS_PER_MODEL })}
                        </Badge>
                      ) : null}
                      {coloursOf(model).length > MAX_COLOUR_PHOTOS_PER_MODEL ? (
                        <Badge variant="danger">
                          {t("tooManyColours", { max: MAX_COLOUR_PHOTOS_PER_MODEL })}
                        </Badge>
                      ) : null}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="ms-auto"
                            aria-label={t("modelMenu")}
                            disabled={Boolean(upload)}
                          >
                            <MoreHorizontal aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={modelIndex === 0}
                            onSelect={() => mergeUp(modelIndex)}
                          >
                            {t("mergeUp")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => removeModel(modelIndex)}
                          >
                            {t("removeModel")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {model.robe ? (
                      <p className="mt-2 text-xs text-muted-foreground">{t("robeHint")}</p>
                    ) : null}
                    <ul className="mt-3 flex gap-3 overflow-x-auto pb-1">
                      {[...model.photos].sort(byTag).map((photo) => {
                        const local = files.get(photo.fileId);
                        const layered = model.robe && photo.tag !== "colour";
                        return (
                          <li key={photo.fileId} className="flex w-24 shrink-0 flex-col gap-1.5">
                            <div className="relative aspect-[4/5] overflow-hidden rounded-[10px] stage">
                              {local?.thumb ? (
                                // Local previews are small object URLs, not remote images.
                                <img
                                  src={local.thumb}
                                  alt={local.file.name}
                                  className="size-full object-contain"
                                  loading="lazy"
                                  decoding="async"
                                />
                              ) : (
                                <div className="size-full shimmer" />
                              )}
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild disabled={Boolean(upload)}>
                                <button
                                  type="button"
                                  className={cn(
                                    "flex h-6 items-center justify-between gap-1 rounded-full px-2 text-[11px] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                                    TAG_STYLE[photo.tag],
                                  )}
                                  aria-label={`${t("photoMenu")}: ${local?.file.name ?? ""}`}
                                >
                                  <span className="truncate">{t(`tags.${photo.tag}`)}</span>
                                  {photo.tagSource === "order" ? (
                                    <span className="opacity-75" title={t("autoHint")}>
                                      {t("auto")}
                                    </span>
                                  ) : null}
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                {INTAKE_TAGS.map((tag) => (
                                  <DropdownMenuItem
                                    key={tag}
                                    onSelect={() => setTag(modelIndex, photo.fileId, tag)}
                                  >
                                    <span
                                      aria-hidden
                                      className={cn("size-2.5 rounded-full", TAG_STYLE[tag])}
                                    />
                                    {t(`tags.${tag}`)}
                                  </DropdownMenuItem>
                                ))}
                                {layered ? (
                                  <>
                                    <DropdownMenuSeparator />
                                    {[...INTAKE_LAYERS, "auto" as const].map((layer) => (
                                      <DropdownMenuItem
                                        key={layer}
                                        onSelect={() => setLayer(modelIndex, photo.fileId, layer)}
                                      >
                                        <span
                                          aria-hidden
                                          className={cn(
                                            "size-2.5 rounded-full border",
                                            photo.layer === layer
                                              ? "border-primary bg-primary"
                                              : "border-border-strong",
                                          )}
                                        />
                                        {t(`layers.${layer}`)}
                                      </DropdownMenuItem>
                                    ))}
                                  </>
                                ) : null}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  disabled={modelIndex === 0}
                                  onSelect={() => movePhoto(modelIndex, photo.fileId, -1)}
                                >
                                  {t("moveUp")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={modelIndex === drafts.length - 1}
                                  onSelect={() => movePhoto(modelIndex, photo.fileId, 1)}
                                >
                                  {t("moveDown")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={model.photos.length < 2}
                                  onSelect={() => splitPhoto(modelIndex, photo.fileId)}
                                >
                                  {t("newModel")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() => removePhoto(modelIndex, photo.fileId)}
                                >
                                  {t("removePhoto")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            {layered ? (
                              <span
                                className={cn(
                                  "flex h-6 items-center justify-center rounded-full border px-2 text-[11px] font-medium",
                                  LAYER_STYLE[photo.layer],
                                )}
                                title={photo.layer === "auto" ? t("layerAutoHint") : undefined}
                              >
                                <span className="truncate">{t(`layers.${photo.layer}`)}</span>
                              </span>
                            ) : null}
                            {photo.tag === "colour" ? (
                              <Input
                                value={photo.colourName}
                                onChange={(event) =>
                                  updatePhoto(modelIndex, photo.fileId, {
                                    colourName: event.target.value,
                                  })
                                }
                                aria-label={t("colourName")}
                                maxLength={120}
                                className="h-7 px-2 text-xs"
                                disabled={Boolean(upload)}
                              />
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}
      </section>

      <aside className="flex flex-col gap-4 xl:sticky xl:top-24 xl:self-start">
        <div className="flex flex-col gap-5 rounded-(--radius-panel) p-5 surface">
          <p className="hud text-muted-foreground">{t("settings")}</p>
          {target ? (
            <p className="font-heading text-2xl">{target.name}</p>
          ) : (
            <>
              <label className="flex flex-col gap-2 text-sm font-medium">
                {t("name")}
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={160}
                  disabled={Boolean(upload)}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium">
                {t("line")}
                <Select
                  value={line}
                  onValueChange={(value) => {
                    setLine(value as ProductLine);
                    setDrafts((current) =>
                      current.map((model) => ({ ...model, productLine: value as ProductLine })),
                    );
                  }}
                  disabled={Boolean(upload)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRODUCT_LINES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value} · {tLines(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <ModelPicker
                models={models}
                value={modelId}
                onChange={setModelId}
                label={t("model")}
                id="batch-model"
              />
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium">{t("dnaCheck")}</legend>
                {(["auto", "review"] as const).map((value) => (
                  <label
                    key={value}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-(--radius-control) border border-border p-3 text-sm transition-colors has-[:checked]:border-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    )}
                  >
                    <input
                      type="radio"
                      name="dna-check"
                      value={value}
                      checked={dnaCheck === value}
                      onChange={() => setDnaCheck(value)}
                      className="mt-0.5 accent-(--primary)"
                      disabled={Boolean(upload)}
                    />
                    <span>{t(value === "auto" ? "dnaAuto" : "dnaReview")}</span>
                  </label>
                ))}
              </fieldset>
              <label className="flex items-start justify-between gap-4 text-sm">
                <span>
                  <span className="font-medium">{t("fidelity")}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t("fidelityHint")}
                  </span>
                </span>
                <Switch
                  checked={fidelity}
                  onCheckedChange={setFidelity}
                  disabled={Boolean(upload)}
                  aria-label={t("fidelity")}
                />
              </label>
              <div className="flex items-center gap-3 rounded-(--radius-control) border border-border p-3 text-xs">
                <span
                  className="size-8 shrink-0 rounded-md border border-border-strong"
                  style={{ background: style.background }}
                />
                <span className="flex-1 text-muted-foreground">
                  {whiteStyle
                    ? t("style", { aspect: style.aspectRatio, padding: style.paddingPercent })
                    : t("styleCustom", {
                        colour: style.background.toUpperCase(),
                        aspect: style.aspectRatio,
                        padding: style.paddingPercent,
                      })}
                </span>
                <Link
                  href="/settings"
                  className="font-medium text-accent-ink underline-offset-4 hover:underline"
                >
                  {t("editStyle")}
                </Link>
              </div>
            </>
          )}

          {upload ? (
            <div className="flex flex-col gap-2" aria-live="polite">
              <p className="text-sm font-medium">
                {t("uploading", { done: upload.done, total: upload.total })}
              </p>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${upload.total ? (upload.done / upload.total) * 100 : 0}%` }}
                />
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {t("uploadingModel", {
                  index: upload.modelIndex,
                  count: drafts.length,
                  name: upload.modelName,
                })}
              </p>
              <p className="text-xs text-muted-foreground">{t("keepOpen")}</p>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <Button size="lg" onClick={() => void start()} disabled={!canStart}>
              {upload ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : target ? (
                <Upload aria-hidden />
              ) : (
                <Sparkles aria-hidden />
              )}
              {target ? t("add", { count: drafts.length }) : t("start", { count: drafts.length })}
            </Button>
            {onCancel ? (
              <Button variant="ghost" onClick={onCancel} disabled={Boolean(upload)}>
                {t("cancel")}
              </Button>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
