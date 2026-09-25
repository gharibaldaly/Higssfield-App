import "server-only";

import { cookies } from "next/headers";

import {
  DEFAULT_EFFECTS,
  DEFAULT_THEME,
  EFFECTS_COOKIE,
  isEffects,
  isTheme,
  THEME_COOKIE,
  type Effects,
  type Theme,
} from "@/lib/i18n/config";

export async function getTheme(): Promise<Theme> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return isTheme(value) ? value : DEFAULT_THEME;
}

export async function getEffects(): Promise<Effects> {
  const value = (await cookies()).get(EFFECTS_COOKIE)?.value;
  return isEffects(value) ? value : DEFAULT_EFFECTS;
}
