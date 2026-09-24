"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
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
    <form onSubmit={submit} className="max-w-3xl">
      <Card>
        <CardContent className="flex flex-col gap-7">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">{t("name")}</Label>
            <Input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={200}
              placeholder={t("namePlaceholder")}
            />
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-sm font-medium">{t("line")}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {PRODUCT_LINES.map((option) => (
                <label
                  key={option}
                  className={cn(
                    "cursor-pointer rounded-2xl p-4 glass transition-all has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    line === option && "ring-2 ring-primary",
                  )}
                >
                  <input
                    type="radio"
                    name="line"
                    value={option}
                    checked={line === option}
                    onChange={() => setLine(option)}
                    className="sr-only"
                  />
                  <span className="block font-display text-lg font-semibold tracking-wide">
                    {option}
                  </span>
                  <span className="text-xs text-muted-foreground">{tl(option)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-sm font-medium">{t("pieceCount")}</legend>
            <div className="inline-flex w-fit rounded-full p-1 glass">
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

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="sku">{t("sku")}</Label>
              <Input
                id="sku"
                value={sku}
                onChange={(event) => setSku(event.target.value)}
                maxLength={80}
                dir="ltr"
              />
            </div>
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
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" size="lg" disabled={pending || !name.trim()}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t("submit")}
            <ArrowRight className="rtl:-scale-x-100" aria-hidden />
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
