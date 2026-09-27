import type * as React from "react";

import { cn } from "@/lib/utils";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Odometer number: each digit column rolls up to its value (CSS only, see .roll). */
export function RollingNumber({ value, className }: { value: number; className?: string }) {
  const digits = String(Math.max(0, Math.round(value))).split("");
  return (
    <span className={cn("inline-flex", className)} dir="ltr">
      <span className="sr-only">{value}</span>
      <span aria-hidden className="inline-flex">
        {digits.map((digit, index) => (
          <span key={index} className="roll">
            <span style={{ "--d": Number(digit), "--i": index } as React.CSSProperties}>
              {DIGITS.map((glyph) => (
                <span key={glyph}>{glyph}</span>
              ))}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}
