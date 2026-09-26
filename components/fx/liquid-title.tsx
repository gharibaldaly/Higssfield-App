import { cn } from "@/lib/utils";

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

/**
 * Display title that fills like a glass: an outline of the words (a faint copy in Arabic, where
 * outlines would show the joins between letters) and the solid title, revealed by a rising wavy
 * liquid line. Pure CSS (.liquid-title), so it renders finished on the server and stays finished
 * in calm mode. The title leans with scroll speed (.fx-skew, driven by SmoothScroll).
 */
export function LiquidTitle({ text, className }: { text: string; className?: string }) {
  const arabic = ARABIC.test(text);
  return (
    <span
      className={cn("liquid-title fx-skew", arabic && "liquid-title-arabic", className)}
      dir={arabic ? "rtl" : "ltr"}
    >
      <span aria-hidden className="liquid-ghost">
        {text}
      </span>
      <span className="liquid-fill">{text}</span>
    </span>
  );
}
