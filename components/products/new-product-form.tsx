"use client";

import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ProductLineBadge } from "@/components/products/product-line-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProductAction } from "@/lib/actions/products";
import { PRODUCT_LINES, type ProductLine } from "@/lib/domain/product";
import { cn } from "@/lib/utils";

export function NewProductForm() {
  const t = useTranslations("products.form");
  const tl = useTranslations("products.lines");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [line, setLine] = useState<ProductLine>("SECRET");
  const [pieceCount, setPieceCount] = useState(1);
  const [pieceNames, setPieceNames] = useState<string[]>(["", "", ""]);
  const [sku, setSku] = useState("");
  const [notes, setNotes] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createProductAction({
        name,
        productLine: line,
        pieceCount,
        pieceNames: pieceNames.slice(0, pieceCount).map((piece) => piece.trim()),
        sku: sku || undefined,
        notes: notes || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("created"));
      router.push(`/products/${result.data.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="max-w-4xl">
      <Card className="divide-y divide-dashed divide-border-strong">
        <Row number={1}>
          <div className="flex flex-col gap-2.5">
            <Label htmlFor="name">{t("name")}</Label>
            <Input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={200}
              placeholder={t("namePlaceholder")}
              className="h-12 text-base"
            />
          </div>
        </Row>

        <Row number={2}>
          <fieldset>
            <legend className="mb-3.5 text-sm font-medium">{t("line")}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {PRODUCT_LINES.map((option) => {
                const selected = line === option;
                return (
                  <label
                    key={option}
                    className={cn(
                      "group relative flex cursor-pointer flex-col items-start gap-3 rounded-(--radius-control) border p-4 transition-[border-color,background-color] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
                      selected
                        ? "border-primary bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]"
                        : "border-border hover:border-border-strong",
                    )}
                  >
                    <input
                      type="radio"
                      name="line"
                      value={option}
                      checked={selected}
                      onChange={() => setLine(option)}
                      className="sr-only"
                    />
                    <ProductLineBadge line={option} />
                    <span className="text-xs text-muted-foreground">{tl(option)}</span>
                    <span
                      aria-hidden
                      className={cn(
                        "absolute end-3 top-3 grid size-5 place-items-center rounded-full border transition-colors",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border-strong",
                      )}
                    >
                      {selected ? <Check className="size-3" /> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </Row>

        <Row number={3}>
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-3.5 text-sm font-medium">{t("pieceCount")}</legend>
            <div className="inline-flex w-fit rounded-full border border-border p-1">
              {[1, 2, 3].map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => setPieceCount(count)}
                  aria-pressed={pieceCount === count}
                  className={cn(
                    "h-9 rounded-full px-5 text-sm font-medium transition-colors",
                    pieceCount === count
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t("piecesOption", { count })}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {Array.from({ length: pieceCount }, (_, index) => (
                <div key={index} className="flex flex-col gap-2">
                  <Label htmlFor={`piece-${index}`}>{t("pieceName", { number: index + 1 })}</Label>
                  <Input
                    id={`piece-${index}`}
                    value={pieceNames[index] ?? ""}
                    onChange={(event) =>
                      setPieceNames((current) =>
                        current.map((value, i) => (i === index ? event.target.value : value)),
                      )
                    }
                    required
                    maxLength={120}
                    placeholder={t(`piecePlaceholders.${index}` as "piecePlaceholders.0")}
                  />
                </div>
              ))}
            </div>
          </fieldset>
        </Row>

        <Row number={4}>
          <div className="flex flex-col gap-5">
            <div className="flex max-w-xs flex-col gap-2">
              <Label htmlFor="sku">{t("sku")}</Label>
              <Input
                id="sku"
                value={sku}
                onChange={(event) => setSku(event.target.value)}
                maxLength={80}
                dir="ltr"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="notes">{t("notes")}</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={4000}
                placeholder={t("notesPlaceholder")}
              />
            </div>
          </div>
        </Row>

        <div className="flex justify-end px-5 py-5 sm:px-6">
          <Button type="submit" size="lg" disabled={pending || !name.trim()}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t("submit")}
            <ArrowRight className="rtl:-scale-x-100" aria-hidden />
          </Button>
        </div>
      </Card>
    </form>
  );
}

/** One line of the order sheet: its step number in the margin, the fields beside it. */
function Row({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <div className="grid gap-3 px-5 py-6 sm:grid-cols-[4rem_minmax(0,1fr)] sm:px-6">
      <span aria-hidden className="pt-0.5 hud text-accent-ink" dir="ltr">
        {String(number).padStart(2, "0")}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
