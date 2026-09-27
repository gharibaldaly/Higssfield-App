"use client";

import { useTranslations } from "next-intl";
import * as React from "react";

import { Field, RowListEditor, StringListEditor } from "@/components/dna/list-editors";
import { Switch } from "@/components/ui/controls";
import { Input, Textarea } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_CHEST_PANEL, type PieceDna } from "@/lib/domain/garment-dna";

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    // A tech-pack section: numbered title in the margin, the spec beside it.
    <section className="grid gap-4 border-t border-dashed border-border-strong pt-7 [counter-increment:dna] first:border-t-0 first:pt-0 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-8">
      <div>
        <h3 className="font-heading text-lg leading-tight before:mb-1.5 before:block before:font-mono before:text-[11px] before:tracking-[0.14em] before:text-accent-ink before:content-[counter(dna,decimal-leading-zero)]">
          {title}
        </h3>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </section>
  );
}

function EnumSelect<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  label: (value: T) => string;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {label(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function HexRangeEditor({
  values,
  onChange,
}: {
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const t = useTranslations("dna.editor");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {values.map((hex, index) => (
        <div
          key={index}
          className="flex items-center gap-1.5 rounded-full border border-border bg-(--surface-solid) py-1 ps-1 pe-2"
        >
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#000000"}
            onChange={(event) =>
              onChange(
                values.map((value, i) => (i === index ? event.target.value.toUpperCase() : value)),
              )
            }
            aria-label={t("pickColor")}
            className="size-7 cursor-pointer rounded-full border-0 bg-transparent p-0"
          />
          <input
            value={hex}
            dir="ltr"
            onChange={(event) =>
              onChange(values.map((value, i) => (i === index ? event.target.value : value)))
            }
            className="w-20 bg-transparent font-mono text-xs uppercase outline-none"
            aria-label={t("hex")}
          />
          {values.length > 1 ? (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-destructive"
              onClick={() => onChange(values.filter((_, i) => i !== index))}
              aria-label={t("remove")}
            >
              ×
            </button>
          ) : null}
        </div>
      ))}
      {values.length < 3 ? (
        <button
          type="button"
          onClick={() => onChange([...values, values[values.length - 1] ?? "#000000"])}
          className="rounded-full border border-dashed border-input px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {t("addShade")}
        </button>
      ) : null}
    </div>
  );
}

export function PieceEditor({
  piece,
  onChange,
}: {
  piece: PieceDna;
  onChange: (piece: PieceDna) => void;
}) {
  const t = useTranslations("dna.editor");
  const patch = (partial: Partial<PieceDna>) => onChange({ ...piece, ...partial });

  return (
    <div className="flex flex-col gap-7 [counter-reset:dna]">
      <Section title={t("identity")}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("category")}>
            <Input
              value={piece.category}
              onChange={(event) => patch({ category: event.target.value })}
              placeholder={t("categoryPlaceholder")}
            />
          </Field>
          <Field label={t("silhouette")}>
            <Input
              value={piece.silhouette}
              onChange={(event) => patch({ silhouette: event.target.value })}
            />
          </Field>
          <Field label={t("lengthAndFit")}>
            <Input
              value={piece.lengthAndFit}
              onChange={(event) => patch({ lengthAndFit: event.target.value })}
            />
          </Field>
        </div>
      </Section>

      {(["frontConstruction", "backConstruction"] as const).map((key) => (
        <Section key={key} title={t(key)} hint={t("topToBottom")}>
          <RowListEditor
            items={piece[key]}
            onChange={(items) => patch({ [key]: items } as Partial<PieceDna>)}
            minItems={1}
            createRow={() => ({ zone: "", detail: "" })}
            addLabel={t("addStep")}
            renderRow={(row, set) => (
              <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
                <Input
                  value={row.zone}
                  onChange={(event) => set({ zone: event.target.value })}
                  placeholder={t("zone")}
                  aria-label={t("zone")}
                />
                <Textarea
                  value={row.detail}
                  onChange={(event) => set({ detail: event.target.value })}
                  placeholder={t("constructionDetail")}
                  aria-label={t("constructionDetail")}
                  className="min-h-10"
                  rows={1}
                />
              </div>
            )}
          />
        </Section>
      ))}

      <Section title={t("fabrics")}>
        <RowListEditor
          items={piece.fabrics}
          onChange={(fabrics) => patch({ fabrics })}
          minItems={1}
          createRow={() => ({ name: "", finish: "", opacity: "opaque" as const, location: "" })}
          addLabel={t("addFabric")}
          renderRow={(row, set) => (
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label={t("fabricName")}>
                <Input value={row.name} onChange={(event) => set({ name: event.target.value })} />
              </Field>
              <Field label={t("finish")}>
                <Input
                  value={row.finish}
                  onChange={(event) => set({ finish: event.target.value })}
                />
              </Field>
              <Field label={t("opacity")}>
                <EnumSelect
                  value={row.opacity}
                  options={["opaque", "semi-sheer", "sheer"] as const}
                  onChange={(opacity) => set({ opacity })}
                  label={(value) => t(`opacityOptions.${value}`)}
                />
              </Field>
              <Field label={t("location")}>
                <Input
                  value={row.location}
                  onChange={(event) => set({ location: event.target.value })}
                />
              </Field>
            </div>
          )}
        />
      </Section>

      <Section title={t("motif")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("motifType")}>
            <EnumSelect
              value={piece.motif.type}
              options={["lace", "print", "embroidery", "jacquard", "none", "other"] as const}
              onChange={(type) => patch({ motif: { ...piece.motif, type } })}
              label={(value) => t(`motifTypes.${value}`)}
            />
          </Field>
          <Field label={t("motifScale")}>
            <Input
              value={piece.motif.scale}
              onChange={(event) => patch({ motif: { ...piece.motif, scale: event.target.value } })}
            />
          </Field>
          <Field label={t("motifDescription")} className="sm:col-span-2">
            <Textarea
              value={piece.motif.description}
              onChange={(event) =>
                patch({ motif: { ...piece.motif, description: event.target.value } })
              }
            />
          </Field>
          <Field label={t("motifPlacement")} className="sm:col-span-2">
            <Input
              value={piece.motif.placement}
              onChange={(event) =>
                patch({ motif: { ...piece.motif, placement: event.target.value } })
              }
            />
          </Field>
        </div>
      </Section>

      <Section title={t("hardware")} hint={t("hardwareHint")}>
        <RowListEditor
          items={piece.hardware}
          onChange={(hardware) => patch({ hardware })}
          createRow={() => ({ item: "", count: null, finish: "", location: "" })}
          addLabel={t("addHardware")}
          renderRow={(row, set) => (
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_100px_minmax(0,1fr)_minmax(0,1fr)]">
              <Field label={t("item")}>
                <Input value={row.item} onChange={(event) => set({ item: event.target.value })} />
              </Field>
              <Field label={t("count")}>
                <Input
                  type="number"
                  min={0}
                  value={row.count ?? ""}
                  placeholder="?"
                  onChange={(event) =>
                    set({
                      count:
                        event.target.value === ""
                          ? null
                          : Math.max(0, Math.round(Number(event.target.value))),
                    })
                  }
                />
              </Field>
              <Field label={t("finish")}>
                <Input
                  value={row.finish}
                  onChange={(event) => set({ finish: event.target.value })}
                />
              </Field>
              <Field label={t("location")}>
                <Input
                  value={row.location}
                  onChange={(event) => set({ location: event.target.value })}
                />
              </Field>
            </div>
          )}
        />
      </Section>

      <Section title={t("colors")}>
        <RowListEditor
          items={piece.colors}
          onChange={(colors) => patch({ colors })}
          minItems={1}
          createRow={() => ({ name: "", hexRange: ["#000000"], location: "" })}
          addLabel={t("addColor")}
          renderRow={(row, set) => (
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
              <Field label={t("colorName")}>
                <Input value={row.name} onChange={(event) => set({ name: event.target.value })} />
              </Field>
              <Field label={t("hexRange")}>
                <HexRangeEditor values={row.hexRange} onChange={(hexRange) => set({ hexRange })} />
              </Field>
              <Field label={t("location")}>
                <Input
                  value={row.location}
                  onChange={(event) => set({ location: event.target.value })}
                />
              </Field>
            </div>
          )}
        />
      </Section>

      <Section title={t("chestPanel")} hint={t("chestPanelHint")}>
        <label className="flex items-center gap-3 text-sm">
          <Switch
            checked={piece.chestPanel !== null}
            onCheckedChange={(checked) =>
              patch({ chestPanel: checked ? { ...DEFAULT_CHEST_PANEL } : null })
            }
          />
          {t("hasChestPanel")}
        </label>
        {piece.chestPanel ? (
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label={t("structure")}>
              <EnumSelect
                value={piece.chestPanel.structure}
                options={["unstructured", "soft-shaped", "structured"] as const}
                onChange={(structure) => patch({ chestPanel: { ...piece.chestPanel!, structure } })}
                label={(value) => t(`structureOptions.${value}`)}
              />
            </Field>
            <Field label={t("projection")}>
              <EnumSelect
                value={piece.chestPanel.projection}
                options={["zero", "soft", "moulded"] as const}
                onChange={(projection) =>
                  patch({ chestPanel: { ...piece.chestPanel!, projection } })
                }
                label={(value) => t(`projectionOptions.${value}`)}
              />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <Switch
                checked={piece.chestPanel.lined}
                onCheckedChange={(lined) => patch({ chestPanel: { ...piece.chestPanel!, lined } })}
              />
              {t("lined")}
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <Switch
                checked={piece.chestPanel.padded}
                onCheckedChange={(padded) =>
                  patch({ chestPanel: { ...piece.chestPanel!, padded } })
                }
              />
              {t("padded")}
            </label>
            <Field label={t("notes")} className="sm:col-span-4">
              <Input
                value={piece.chestPanel.notes}
                onChange={(event) =>
                  patch({ chestPanel: { ...piece.chestPanel!, notes: event.target.value } })
                }
              />
            </Field>
          </div>
        ) : null}
      </Section>

      <Section title={t("keyDetails")} hint={t("keyDetailsHint")}>
        <RowListEditor
          items={piece.keyDetails}
          onChange={(keyDetails) => patch({ keyDetails })}
          minItems={1}
          createRow={() => ({
            label: "",
            description: "",
            zone: "",
            importance: "high" as const,
            sellingPoint: true,
          })}
          addLabel={t("addDetail")}
          renderRow={(row, set) => (
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label={t("detailLabel")}>
                <Input value={row.label} onChange={(event) => set({ label: event.target.value })} />
              </Field>
              <Field label={t("zone")}>
                <Input value={row.zone} onChange={(event) => set({ zone: event.target.value })} />
              </Field>
              <Field label={t("importance")}>
                <EnumSelect
                  value={row.importance}
                  options={["critical", "high", "medium"] as const}
                  onChange={(importance) => set({ importance })}
                  label={(value) => t(`importanceOptions.${value}`)}
                />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <Switch
                  checked={row.sellingPoint}
                  onCheckedChange={(sellingPoint) => set({ sellingPoint })}
                />
                {t("sellingPoint")}
              </label>
              <Field label={t("detailDescription")} className="sm:col-span-4">
                <Textarea
                  value={row.description}
                  onChange={(event) => set({ description: event.target.value })}
                  className="min-h-16"
                />
              </Field>
            </div>
          )}
        />
      </Section>

      <Section title={t("doNotAlter")} hint={t("doNotAlterHint")}>
        <StringListEditor
          items={piece.doNotAlter}
          onChange={(doNotAlter) => patch({ doNotAlter })}
          minItems={1}
          addLabel={t("addRule")}
          placeholder={t("rulePlaceholder")}
        />
      </Section>
    </div>
  );
}
