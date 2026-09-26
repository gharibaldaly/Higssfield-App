"use client";

import { FileJson, Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { saveCustomModelsAction } from "@/lib/actions/settings";

/**
 * Example entry. Replace the endpoint and fields with the values from
 * docs.higgsfield.ai — the app only sends parameters declared here.
 */
const TEMPLATE = [
  {
    id: "my-image-to-video-model",
    label: "My image-to-video model",
    endpoint: "path/from/higgsfield/docs",
    kind: "video",
    modes: ["image-to-video"],
    params: {
      prompt: { field: "prompt" },
      image: { field: "image_url", format: "url", max: 1, required: true },
      aspectRatio: {
        field: "aspect_ratio",
        options: [
          { value: "9:16", label: "9:16" },
          { value: "16:9", label: "16:9" },
        ],
        default: "9:16",
      },
      duration: { field: "duration", options: [5, 10], default: 5 },
    },
    source: "custom",
  },
];

export function CustomModelsEditor({ initialJson }: { initialJson: string }) {
  const t = useTranslations("settings.models.custom");
  const router = useRouter();
  const [value, setValue] = useState(initialJson === "[]" ? "" : initialJson);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-3 rounded-(--radius-control) border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <FileJson className="size-4" aria-hidden />
            {t("title")}
          </p>
          <p className="text-xs text-muted-foreground">{t("hint")}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setValue(JSON.stringify(TEMPLATE, null, 2))}
        >
          {t("template")}
        </Button>
      </div>
      <Textarea
        dir="ltr"
        spellCheck={false}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="min-h-56 font-mono text-xs"
        placeholder="[]"
        aria-label={t("title")}
      />
      <Button
        className="w-fit"
        variant="surface"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await saveCustomModelsAction(value.trim() || "[]");
            if (!result.ok) toast.error(result.error);
            else {
              toast.success(t("saved", { count: result.data.count }));
              router.refresh();
            }
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
        {t("save")}
      </Button>
    </div>
  );
}
