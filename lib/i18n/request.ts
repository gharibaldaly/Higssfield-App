import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from "@/lib/i18n/config";

/**
 * Locale comes from a cookie (no /ar /en URL prefixes): this is a private,
 * single-user studio, so clean URLs matter more than locale-addressable pages.
 */
export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: "Africa/Cairo",
    // Shared by the server render and hydration so relative times match.
    now: new Date(),
  };
});
