"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function RowControls({
  index,
  count,
  onMove,
  onRemove,
  minItems,
}: {
  index: number;
  count: number;
  onMove: (to: number) => void;
  onRemove: () => void;
  minItems: number;
}) {
  const t = useTranslations("dna.editor");
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("moveUp")}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
      >
        <ArrowUp aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("moveDown")}
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
      >
        <ArrowDown aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("remove")}
        disabled={count <= minItems}
        onClick={onRemove}
        className="text-destructive"
      >
        <Trash2 aria-hidden />
      </Button>
    </div>
  );
}

/**
 * Ordered list of short strings (do-not-alter rules, gaps…). Outside a <Field>, pass `itemLabel`
 * so every input gets its own accessible name.
 */
export function StringListEditor({
  items,
  onChange,
  placeholder,
  addLabel,
  itemLabel,
  minItems = 0,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  addLabel: string;
  itemLabel?: (index: number) => string;
  minItems?: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={item}
            aria-label={itemLabel?.(index)}
            placeholder={placeholder}
            onChange={(event) =>
              onChange(items.map((value, i) => (i === index ? event.target.value : value)))
            }
          />
          <RowControls
            index={index}
            count={items.length}
            minItems={minItems}
            onMove={(to) => onChange(move(items, index, to))}
            onRemove={() => onChange(items.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => onChange([...items, ""])}
      >
        <Plus aria-hidden />
        {addLabel}
      </Button>
    </div>
  );
}

/**
 * Ordered list of structured rows. `renderRow` receives the row and a patch
 * function; rows can be moved (construction order matters: top → bottom).
 */
export function RowListEditor<T>({
  items,
  onChange,
  renderRow,
  createRow,
  addLabel,
  minItems = 0,
  className,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  renderRow: (row: T, patch: (partial: Partial<T>) => void, index: number) => React.ReactNode;
  createRow: () => T;
  addLabel: string;
  minItems?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {items.map((row, index) => (
        <div key={index} className="flex items-start gap-2 rounded-2xl bg-muted/60 p-3">
          <span className="mt-2.5 grid size-6 shrink-0 place-items-center rounded-full bg-background/60 text-xs font-semibold text-muted-foreground">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            {renderRow(
              row,
              (partial) =>
                onChange(items.map((value, i) => (i === index ? { ...value, ...partial } : value))),
              index,
            )}
          </div>
          <RowControls
            index={index}
            count={items.length}
            minItems={minItems}
            onMove={(to) => onChange(move(items, index, to))}
            onRemove={() => onChange(items.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => onChange([...items, createRow()])}
      >
        <Plus aria-hidden />
        {addLabel}
      </Button>
    </div>
  );
}

/** Small labelled field used inside rows. */
export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
