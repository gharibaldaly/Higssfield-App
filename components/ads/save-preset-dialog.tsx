"use client";

import { Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { savePresetAction } from "@/lib/actions/director";
import type { DirectorControls, VideoSettings } from "@/lib/domain/director";

export function SavePresetDialog({
  open,
  onOpenChange,
  presets,
  currentPresetId,
  controls,
  videoSettings,
  rules,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: { id: string; name: string; isBuiltin: boolean }[];
  currentPresetId: string | null;
  controls: DirectorControls;
  videoSettings: VideoSettings;
  rules: string[];
}) {
  const t = useTranslations("director.presetDialog");
  const router = useRouter();
  const [target, setTarget] = useState<string>("__new");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();
  const existing = presets.find((preset) => preset.id === target) ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setTarget(currentPresetId ?? "__new");
          setName(presets.find((preset) => preset.id === currentPresetId)?.name ?? "");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>{t("saveTo")}</Label>
            <Select
              value={target}
              onValueChange={(value) => {
                setTarget(value);
                setName(presets.find((preset) => preset.id === value)?.name ?? "");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__new">{t("newPreset")}</SelectItem>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {t("overwrite", { name: preset.name })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="preset-name">{t("name")}</Label>
            <Input
              id="preset-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="preset-description">{t("description")}</Label>
            <Textarea
              id="preset-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {existing?.isBuiltin ? (
            <p className="text-xs text-muted-foreground">{t("builtinNote")}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !name.trim()}
            onClick={() =>
              startTransition(async () => {
                const result = await savePresetAction({
                  presetId: target === "__new" ? null : target,
                  name,
                  description: description || undefined,
                  controls,
                  videoSettings,
                  rules,
                });
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success(t("saved"));
                onOpenChange(false);
                router.refresh();
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
