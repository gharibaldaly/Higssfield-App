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
  return (
    <span className={cn("fx-words", className)}>
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
