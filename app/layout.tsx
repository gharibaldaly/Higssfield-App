import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import { Providers } from "@/components/providers";
import { fontVariables } from "@/lib/fonts";
import { directionFor, isLocale, DEFAULT_LOCALE } from "@/lib/i18n/config";
import { getTheme } from "@/lib/preferences";
import { cn } from "@/lib/utils";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return {
    title: { default: t("name"), template: `%s · ${t("name")}` },
    description: t("tagline"),
    robots: { index: false, follow: false },
  };
}

// The browser bar follows the studio theme (cookie), not the OS colour scheme.
export async function generateViewport(): Promise<Viewport> {
  const theme = await getTheme();
  return { themeColor: theme === "dark" ? "#0d090a" : "#f3eee8" };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const rawLocale = await getLocale();
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const theme = await getTheme();
  const dir = directionFor(locale);
  return (
    <html lang={locale} dir={dir} className={cn(fontVariables, theme === "dark" && "dark")}>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>
          <Providers dir={dir} theme={theme}>
            {children}
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
