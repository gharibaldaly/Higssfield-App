"use client";

import {
  ArrowRight,
  Check,
  CheckCircle2,
  Dna,
  LayoutPanelLeft,
  Palette,
  Pencil,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/common/confirm-dialog";
import { PhotoDropzone } from "@/components/products/photo-dropzone";
import { PhotoTile } from "@/components/products/photo-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
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
import { deleteProductAction, updateProductAction } from "@/lib/actions/products";
import { PHOTO_KINDS, PRODUCT_LINES, type ProductLine } from "@/lib/domain/product";
import type { PhotoView } from "@/lib/products/queries";
import { cn } from "@/lib/utils";

type Piece = { id: string; name: string; position: number };

export function IntakeView({
  ownerId,
  product,
  pieces,
  photos,
  latestDna,
  colorwayCount,
  sheetStatus,
  approvedDna,
  approvedSheet,
}: {
  ownerId: string;
  product: {
    id: string;
    name: string;
    productLine: ProductLine;
    sku: string | null;
    notes: string | null;
  };
  pieces: Piece[];
  photos: PhotoView[];
  latestDna: { id: string; version: number; status: string } | null;
  colorwayCount: number;
  sheetStatus: string | null;
  approvedDna: boolean;
  approvedSheet: boolean;
}) {
  const t = useTranslations("products.intake");
  const hasFront = pieces.every((piece) =>
    photos.some((photo) => photo.pieceId === piece.id && photo.kind === "front"),
  );
  const steps = [
    { key: "photos", done: hasFront, href: null, icon: CheckCircle2 },
    { key: "dna", done: approvedDna, href: `/products/${product.id}/dna`, icon: Dna },
    {
      key: "colorways",
      done: colorwayCount > 0,
      href: `/products/${product.id}/colorways`,
      icon: Palette,
    },
    {
      key: "sheet",
      done: approvedSheet,
      href: `/products/${product.id}/sheet`,
      icon: LayoutPanelLeft,
    },
  ] as const;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-6">
        {pieces.map((piece) => (
          <Card key={piece.id}>
            <CardHeader>
              <CardTitle id={`${piece.id}-title`} className="flex items-baseline gap-3">
                <span className="hud text-accent-ink">
                  {t("piece", { number: piece.position })}
                </span>
                <span className="text-2xl">{piece.name}</span>
              </CardTitle>
              <CardDescription>{t("pieceHint")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-3 lg:divide-x lg:divide-dashed lg:divide-border-strong [&>section]:lg:px-5 [&>section:first-child]:lg:ps-0 [&>section:last-child]:lg:pe-0">
              {PHOTO_KINDS.map((kind) => {
                const list = photos.filter(
                  (photo) => photo.pieceId === piece.id && photo.kind === kind,
                );
                return (
                  <section
                    key={kind}
                    // Piece name + view, so each region's name is unique ("Robe · Front").
                    aria-labelledby={`${piece.id}-title ${piece.id}-${kind}`}
                    className={cn(kind === "detail" && "lg:col-span-1")}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <h3 id={`${piece.id}-${kind}`} className="hud text-foreground">
                        {t(`kinds.${kind}`)}
                      </h3>
                      <Badge
                        className="font-mono"
                        variant={
                          list.length > 0 ? "success" : kind === "detail" ? "muted" : "warning"
                        }
                      >
                        {list.length}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {list.map((photo) => (
                        <PhotoTile key={photo.id} photo={photo} productId={product.id} />
                      ))}
                      <PhotoDropzone
                        ownerId={ownerId}
                        productId={product.id}
                        pieceId={piece.id}
                        kind={kind}
                        compact={list.length > 0}
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{t(`kindHints.${kind}`)}</p>
                  </section>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>

      <aside className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("nextSteps")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="relative flex flex-col gap-1 before:absolute before:inset-y-6 before:start-[1.45rem] before:w-px before:bg-border-strong">
              {steps.map((step) => {
                const content = (
                  <>
                    <span
                      aria-hidden
                      className={cn(
                        "relative grid size-5 shrink-0 place-items-center rounded-full border-2",
                        step.done
                          ? "border-success bg-success text-background"
                          : "border-border-strong bg-(--surface-solid)",
                      )}
                    >
                      {step.done ? <Check className="size-3" strokeWidth={3} /> : null}
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-medium">
                        {t(`steps.${step.key}.title`)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {step.key === "dna" && latestDna
                          ? t("steps.dna.status", {
                              version: latestDna.version,
                              status: t(
                                `dnaStatus.${latestDna.status as "draft" | "approved" | "superseded"}`,
                              ),
                            })
                          : step.key === "sheet" && sheetStatus
                            ? t("steps.sheet.status", {
                                status: t(
                                  `sheetStatus.${sheetStatus as "draft" | "generating" | "review" | "approved" | "failed"}`,
                                ),
                              })
                            : t(`steps.${step.key}.hint`)}
                      </span>
                    </span>
                    {step.href ? (
                      <ArrowRight
                        className="size-4 text-muted-foreground rtl:-scale-x-100"
                        aria-hidden
                      />
                    ) : null}
                  </>
                );
                return (
                  <li key={step.key}>
                    {step.href ? (
                      <Link
                        href={step.href}
                        className="flex items-center gap-3 rounded-(--radius-control) p-3 transition-colors hover:bg-muted"
                      >
                        {content}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-3 p-3">{content}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
        <ProductSettingsCard product={product} pieces={pieces} />
      </aside>
    </div>
  );
}

function ProductSettingsCard({
  product,
  pieces,
}: {
  product: {
    id: string;
    name: string;
    productLine: ProductLine;
    sku: string | null;
    notes: string | null;
  };
  pieces: Piece[];
}) {
  const t = useTranslations("products.intake");
  const tl = useTranslations("products.lines");
  const confirm = useConfirm();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(product.name);
  const [line, setLine] = useState<ProductLine>(product.productLine);
  const [sku, setSku] = useState(product.sku ?? "");
  const [notes, setNotes] = useState(product.notes ?? "");
  const [pieceNames, setPieceNames] = useState(pieces.map((piece) => piece.name));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("details")}</CardTitle>
        <CardDescription>{product.notes || t("noNotes")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button variant="surface" onClick={() => setOpen(true)}>
          <Pencil aria-hidden />
          {t("edit")}
        </Button>
        <Button
          variant="ghost"
          className="text-destructive"
          disabled={pending}
          onClick={async () => {
            const confirmed = await confirm({
              title: t("delete"),
              description: t("confirmDelete"),
              confirmLabel: t("delete"),
              destructive: true,
            });
            if (!confirmed) return;
            startTransition(async () => {
              const result = await deleteProductAction(product.id);
              if (!result.ok) toast.error(result.error);
              else {
                toast.success(t("deleted"));
                router.push("/products");
              }
            });
          }}
        >
          <Trash2 aria-hidden />
          {t("delete")}
        </Button>
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("edit")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-name">{t("name")}</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t("line")}</Label>
              <Select value={line} onValueChange={(value) => setLine(value as ProductLine)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_LINES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option} · {tl(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {pieces.map((piece, index) => (
              <div key={piece.id} className="flex flex-col gap-2">
                <Label htmlFor={`edit-piece-${piece.id}`}>
                  {t("piece", { number: piece.position })}
                </Label>
                <Input
                  id={`edit-piece-${piece.id}`}
                  value={pieceNames[index] ?? ""}
                  onChange={(event) =>
                    setPieceNames((current) =>
                      current.map((value, i) => (i === index ? event.target.value : value)),
                    )
                  }
                />
              </div>
            ))}
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-sku">{t("sku")}</Label>
              <Input
                id="edit-sku"
                value={sku}
                onChange={(event) => setSku(event.target.value)}
                dir="ltr"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-notes">{t("notes")}</Label>
              <Textarea
                id="edit-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await updateProductAction({
                    productId: product.id,
                    name,
                    productLine: line,
                    sku: sku || undefined,
                    notes: notes || undefined,
                    pieces: pieces.map((piece, index) => ({
                      id: piece.id,
                      name: pieceNames[index] ?? piece.name,
                    })),
                  });
                  if (!result.ok) toast.error(result.error);
                  else {
                    toast.success(t("saved"));
                    setOpen(false);
                    router.refresh();
                  }
                })
              }
            >
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
