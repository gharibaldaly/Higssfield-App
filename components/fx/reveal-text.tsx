import type * as React from "react";

import { cn } from "@/lib/utils";

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

/**
 * Title reveal rendered on the server; the motion is pure CSS (see .fx-words / .fx-ink).
 * Latin rises word by word. Arabic is written in by an ink sweep from the right, so its
 * joined letters are never split apart.
 */
export function RevealText({ text, className }: { text: string; className?: string }) {
  if (ARABIC.test(text)) {
    return <span className={cn("fx-ink inline-block", className)}>{text}</span>;
  }
  let index = 0;
  // Each word is an inline-block, which the bidi algorithm would reorder inside an Arabic page;
  // an explicit LTR run keeps a Latin title in reading order there.
  return (
    <span className={cn("fx-words", className)} dir="ltr">
      {text.split(/(\s+)/).map((part, position) =>
        /^\s*$/.test(part) ? (
          part
        ) : (
          <span key={position} style={{ "--i": index++ } as React.CSSProperties}>
            {part}
          </span>
        ),
      )}
    </span>
  );
}
