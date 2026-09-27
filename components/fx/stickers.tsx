import type * as React from "react";

import { ringPath, starPoints } from "@/lib/fx/shapes";
import { cn } from "@/lib/utils";

/*
 * Stickers and doodles around the hero, after the stickers on sloshseltzer.com, drawn from the
 * workroom: a starburst swing tag, a text ring around a sewing button, a hand-drawn arrow, and
 * small line drawings (needle, spool, button, stitches). All decorative (aria-hidden) and never
 * placed over garment images. Their motion is CSS (.sticker-spin, .scribble, .doodle).
 */

const STAR = starPoints(18, 59, 50, 60, 60);
const RING_RADIUS = 47;
const RING_LENGTH = Math.round(2 * Math.PI * RING_RADIUS);
const STAR_STITCH = starPoints(18, 53, 45, 60, 60);

/** A starburst swing tag: a big figure and a short label. Fixed colours in both themes. */
export function Starburst({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("relative grid aspect-square place-items-center", className)}>
      <svg viewBox="0 0 120 120" className="sticker-spin absolute inset-0 size-full">
        <polygon
          points={STAR}
          fill="#ffb8cb"
          stroke="#2a0714"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <polygon
          points={STAR_STITCH}
          fill="none"
          stroke="#2a0714"
          strokeWidth="0.7"
          strokeDasharray="2.4 2.2"
          strokeLinejoin="round"
        />
      </svg>
      <span className="relative flex flex-col items-center text-center leading-none text-[#2a0714]">
        <span className="font-editorial text-[2.15em] tracking-tight" dir="ltr">
          {value}
        </span>
        <span className="mt-1 max-w-[7em] hud leading-tight">{label}</span>
      </span>
    </div>
  );
}

/** Text set on a turning ring around a four-hole sewing button. */
export function RingText({
  id,
  text,
  className,
}: {
  id: string;
  text: string;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("relative aspect-square", className)}>
      <svg
        viewBox="0 0 120 120"
        className="sticker-spin-slow absolute inset-0 size-full overflow-visible"
      >
        <defs>
          <path id={id} d={ringPath(60, 60, RING_RADIUS)} />
        </defs>
        {/* Centred and fitted to the ring, so it closes the circle in either writing direction;
            scaling glyphs (not spacing) keeps Arabic letters joined. */}
        <text className="ring-text fill-current" textAnchor="middle">
          <textPath
            href={`#${id}`}
            startOffset="50%"
            textLength={RING_LENGTH}
            lengthAdjust="spacingAndGlyphs"
          >
            {text}
          </textPath>
        </text>
      </svg>
      <svg viewBox="0 0 40 40" className="absolute inset-[31%] size-[38%]">
        <circle cx="20" cy="20" r="17" fill="currentColor" />
        <circle
          cx="20"
          cy="20"
          r="13.5"
          fill="none"
          stroke="var(--background)"
          strokeWidth="0.8"
          opacity="0.5"
        />
        {[
          [15.5, 15.5],
          [24.5, 15.5],
          [15.5, 24.5],
          [24.5, 24.5],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.3" fill="var(--background)" />
        ))}
        <path
          d="M15.5 15.5 24.5 24.5 M24.5 15.5 15.5 24.5"
          stroke="var(--background)"
          strokeWidth="1.1"
        />
      </svg>
    </div>
  );
}

/** A looping, hand-drawn arrow that draws itself in; mirror it with a class in RTL layouts. */
export function ScribbleArrow({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 120 80"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("overflow-visible", className)}
    >
      <path
        pathLength={1}
        className="scribble-path"
        d="M4 12C34 2 66 10 76 32C84 50 70 64 58 55C47 47 62 30 86 41C100 48 107 58 110 70"
      />
      <path pathLength={1} className="scribble-head" d="M98 66L110 72L114 59" />
    </svg>
  );
}

type DoodleKind = "sparkle" | "button" | "cross" | "zigzag" | "spool" | "needle" | "heart";

const DOODLE_PATHS: Record<DoodleKind, React.ReactNode> = {
  sparkle: (
    <path
      d="M12 2C12 8 16 12 22 12 16 12 12 16 12 22 12 16 8 12 2 12 8 12 12 8 12 2Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  button: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="9.5" cy="9.5" r="1.1" fill="currentColor" />
      <circle cx="14.5" cy="9.5" r="1.1" fill="currentColor" />
      <circle cx="9.5" cy="14.5" r="1.1" fill="currentColor" />
      <circle cx="14.5" cy="14.5" r="1.1" fill="currentColor" />
    </>
  ),
  cross: <path d="M5 5 19 19M19 5 5 19" />,
  zigzag: <path d="M2 15 6 9l4 6 4-6 4 6 4-6" />,
  spool: <path d="M6 4h12M6 20h12M8 4v16M16 4v16M8 8l8 3M8 12l8 3M8 16l8 1" />,
  needle: <path d="M5 19 18 6M16.5 4.5a2 2 0 1 1 3 3M5 19c3 2 6-2 9 0" />,
  heart: <path d="M12 20C5 14 3 10 6 7c2.5-2.5 5-1 6 1 1-2 3.5-3.5 6-1 3 3 1 7-6 13Z" />,
};

export type Doodle = {
  kind: DoodleKind;
  top: string;
  start: string;
  size: number;
  /** How strongly it drifts up as the page scrolls (parallax). */
  depth: number;
  rotate?: number;
};

/** Small line drawings scattered over an area; they bob gently and drift with the scroll. */
export function Doodles({ items, className }: { items: Doodle[]; className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0", className)}>
      {items.map((item, index) => (
        <span
          key={`${item.kind}-${index}`}
          className="doodle absolute"
          style={
            {
              top: item.top,
              insetInlineStart: item.start,
              width: item.size,
              height: item.size,
              rotate: `${item.rotate ?? 0}deg`,
              "--i": index,
              "--depth": item.depth,
            } as React.CSSProperties
          }
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-full"
          >
            {DOODLE_PATHS[item.kind]}
          </svg>
        </span>
      ))}
    </div>
  );
}
