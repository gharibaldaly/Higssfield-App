"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";

import { isLocale, isTheme, LOCALE_COOKIE, THEME_COOKIE } from "@/lib/i18n/config";

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
  refresh();
}

export async function setTheme(theme: string): Promise<void> {
  if (!isTheme(theme)) return;
  (await cookies()).set(THEME_COOKIE, theme, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
  refresh();
}
