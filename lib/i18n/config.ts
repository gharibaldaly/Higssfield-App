export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** The owner works in Arabic; English is one tap away in the top bar. */
export const DEFAULT_LOCALE: Locale = "ar";
export const LOCALE_COOKIE = "NEXT_LOCALE";

export const THEMES = ["dark", "light"] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = "dark";
export const THEME_COOKIE = "theme";

export function isLocale(value: string | undefined | null): value is Locale {
  return value === "ar" || value === "en";
}

export function isTheme(value: string | undefined | null): value is Theme {
  return value === "dark" || value === "light";
}

export function directionFor(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}
