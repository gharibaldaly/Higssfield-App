"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function StudioError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");
  return (
    <Card className="mx-auto mt-10 flex max-w-lg flex-col items-center gap-4 p-10 text-center">
      <AlertTriangle className="size-8 text-destructive" aria-hidden />
      <h1 className="font-display text-4xl leading-tight">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("body")}</p>
      {error.digest ? (
        <code className="text-xs text-muted-foreground" dir="ltr">
          {error.digest}
        </code>
      ) : null}
      <Button onClick={reset}>
        <RotateCcw aria-hidden />
        {t("retry")}
      </Button>
    </Card>
  );
}
