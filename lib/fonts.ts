import {
  Aref_Ruqaa,
  Gloock,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  IBM_Plex_Sans_Arabic,
} from "next/font/google";

/** Arabic display: Ruq'ah calligraphy, used for page titles and the hero only. */
export const ruqaa = Aref_Ruqaa({
  subsets: ["arabic", "latin"],
  weight: ["400", "700"],
  variable: "--font-ruqaa",
  display: "swap",
});

/** English display and Latin numerals in editorial settings. */
export const gloock = Gloock({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-gloock",
  display: "swap",
});

/** English UI (variable weight). */
export const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-plex",
  display: "swap",
});

/** Arabic UI. Its Latin glyphs come from IBM Plex Sans, which it was drawn to match. */
export const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});

/** Labels, data, timecodes and measurements. */
export const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const fontVariables = [ruqaa, gloock, plexSans, plexArabic, plexMono]
  .map((font) => font.variable)
  .join(" ");
