"use client";

import { useTranslations } from "next-intl";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";

import { GhostForm } from "@/components/fx/ghost-form";
import { PRODUCT_LINES, type ProductLine } from "@/lib/domain/product";
import { wavePath } from "@/lib/fx/shapes";

/**
 * Each band keeps its line's woven-label colours in both themes (see ProductLineBadge). The
 * form turns to ink over the light grounds and takes the line's colours as it crosses a band.
 */
const BANDS: Record<
  ProductLine,
  { ground: string; ink: string; form: { surface: string; seam: string; stand: string } }
> = {
  SECRET: {
    ground: "#ffb8cb",
    ink: "#2a0714",
    form: { surface: "#7a1a3a", seam: "#c0265e", stand: "#2a0714" },
  },
  HOURS: {
    ground: "#86e7c0",
    ink: "#062a22",
    form: { surface: "#0e5c49", seam: "#062a22", stand: "#0b3d31" },
  },
  VOWS: {
    ground: "#f3efe8",
    ink: "#062a22",
    form: { surface: "#3e6158", seam: "#062a22", stand: "#6f8a82" },
  },
};

/** Five whole waves across the strip; it slides sideways with the scroll. */
const EDGE = wavePath({ width: 2400, height: 60, baseline: 32, amplitude: 18, waves: 5 });
const WORDS = 6;

function Edge({ color, position }: { color: string; position: "top" | "bottom" }) {
  return (
    <div aria-hidden className={`band-edge band-edge-${position}`} style={{ color }}>
      <svg viewBox="0 0 2400 60" preserveAspectRatio="none" focusable="false">
        <path d={EDGE} fill="currentColor" />
      </svg>
    </div>
  );
}

/**
 * The three product lines as colour bands of huge repeated names that slide sideways with the
 * scroll (after the flavour bands on sloshseltzer.com), with liquid edges between them. The
 * display form stays in view while the bands pass beneath it and takes each line's colours.
 */
export function LineBands() {
  const t = useTranslations("home.lines");
  const tl = useTranslations("products.lines");
  const sectionRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState<ProductLine>(PRODUCT_LINES[0]);

  // The band crossing the middle of the screen sets the form's colours.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const line = entry.target.getAttribute("data-band");
          if (entry.isIntersecting && line) setActive(line as ProductLine);
        }
      },
      { rootMargin: "-50% 0px -50% 0px" },
    );
    for (const band of section.querySelectorAll("[data-band]")) observer.observe(band);
    return () => observer.disconnect();
  }, []);

  const tone = BANDS[active].form;
  return (
    <section
      ref={sectionRef}
      aria-labelledby="lines-title"
      className="relative -mx-4 my-16 sm:-mx-6 lg:-mx-10"
    >
      <h2 id="lines-title" className="sr-only">
        {t("title")}
      </h2>
      {PRODUCT_LINES.map((line, index) => {
        const band = BANDS[line];
        return (
          <div
            key={line}
            data-band={line}
            className="band relative flex min-h-[58vh] flex-col items-center justify-center gap-8 py-20"
            style={{ backgroundColor: band.ground, color: band.ink }}
          >
            <Edge color={band.ground} position="top" />
            <div
              aria-hidden
              className="band-track"
              dir="ltr"
              style={{ "--band-dir": index % 2 === 0 ? -1 : 1 } as React.CSSProperties}
            >
              {Array.from({ length: WORDS }, (_, word) => (
                <span key={word} className={word % 2 ? "band-word band-word-outline" : "band-word"}>
                  {line}
                </span>
              ))}
            </div>
            <p className="relative z-20 flex items-center gap-3 rounded-full border border-current px-4 py-1.5 hud">
              <span dir="ltr">{line}</span>
              <span aria-hidden>·</span>
              <span>{tl(line)}</span>
            </p>
            {index === PRODUCT_LINES.length - 1 ? (
              <Edge color={band.ground} position="bottom" />
            ) : null}
          </div>
        );
      })}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
        <div
          className="sticky top-0 h-dvh"
          style={
            {
              "--form-tone": "ink",
              "--form-surface": tone.surface,
              "--form-seam": tone.seam,
              "--form-stand": tone.stand,
            } as React.CSSProperties
          }
        >
          <GhostForm className="absolute inset-x-0 inset-y-[12vh]" spin="scroll" tone={active} />
        </div>
      </div>
    </section>
  );
}
