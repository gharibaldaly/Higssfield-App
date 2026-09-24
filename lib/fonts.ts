import { Cormorant_Garamond, Jost, Tajawal } from "next/font/google";

/** English UI. */
export const jost = Jost({
  subsets: ["latin"],
  variable: "--font-jost",
  display: "swap",
});

/** English display titles. */
export const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});

/** Arabic UI and titles. */
export const tajawal = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "700", "800"],
  variable: "--font-tajawal",
  display: "swap",
});

export const fontVariables = `${jost.variable} ${cormorant.variable} ${tajawal.variable}`;
