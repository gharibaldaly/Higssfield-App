"use client";

import { Moon, Sun } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/overlays";
import { setEffects, setLocale, setTheme } from "@/lib/actions/preferences";
import type { Effects } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

export function LocaleToggle({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useTranslations("preferences");
  const [pending, startTransition] = useTransition();
  const next = locale === "ar" ? "en" : "ar";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="surface"
          size="sm"
          className={cn("h-9 px-3.5", className)}
          disabled={pending}
          onClick={() => startTransition(() => setLocale(next))}
          aria-label={t("switchLanguage")}
        >
          <span className={next === "ar" ? "font-arabic" : "hud"}>
            {next === "ar" ? "العربية" : "English"}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("switchLanguage")}</TooltipContent>
    </Tooltip>
  );
}

export function ThemeToggle({ theme, className }: { theme: "dark" | "light"; className?: string }) {
  const t = useTranslations("preferences");
  const [pending, startTransition] = useTransition();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="surface"
          size="icon-sm"
          className={cn("size-9", className)}
          disabled={pending}
          onClick={() => {
            // Flip instantly for feedback; the cookie keeps it for the next load.
            document.documentElement.classList.toggle("dark", next === "dark");
            startTransition(() => setTheme(next));
          }}
          aria-label={next === "dark" ? t("darkMode") : t("lightMode")}
        >
          {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{next === "dark" ? t("darkMode") : t("lightMode")}</TooltipContent>
    </Tooltip>
  );
}

/** Motion & effects on/off. Flips html[data-fx] at once; the cookie keeps it for the next load. */
export function EffectsToggle({ effects, className }: { effects: Effects; className?: string }) {
  const t = useTranslations("preferences");
  const [current, setCurrent] = useState(effects);
  const [, startTransition] = useTransition();
  const on = current === "full";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="surface"
          size="sm"
          className={cn("h-9 gap-2 px-3", className)}
          aria-pressed={on}
          aria-label={t("effects")}
          onClick={() => {
            const next: Effects = on ? "calm" : "full";
            document.documentElement.dataset.fx = next;
            setCurrent(next);
            startTransition(() => setEffects(next));
          }}
        >
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full border border-current transition-colors",
              on ? "border-primary bg-primary" : "bg-transparent",
            )}
          />
          <span aria-hidden className="hud">
            FX
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {t("effects")}: {on ? t("on") : t("off")}
      </TooltipContent>
    </Tooltip>
  );
}
