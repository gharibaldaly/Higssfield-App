"use client";

import { Languages, Moon, Sun } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/overlays";
import { setLocale, setTheme } from "@/lib/actions/preferences";

export function LocaleToggle() {
  const locale = useLocale();
  const t = useTranslations("preferences");
  const [pending, startTransition] = useTransition();
  const next = locale === "ar" ? "en" : "ar";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="glass"
          size="sm"
          className="h-9 gap-1.5 px-3"
          disabled={pending}
          onClick={() => startTransition(() => setLocale(next))}
          aria-label={t("switchLanguage")}
        >
          <Languages className="size-4" aria-hidden />
          <span className={next === "ar" ? "font-arabic" : undefined}>
            {next === "ar" ? "العربية" : "English"}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("switchLanguage")}</TooltipContent>
    </Tooltip>
  );
}

export function ThemeToggle({ theme }: { theme: "dark" | "light" }) {
  const t = useTranslations("preferences");
  const [pending, startTransition] = useTransition();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="glass"
          size="icon-sm"
          className="size-9"
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
