"use client";

import { useEffect, useRef } from "react";

import { createProgram, mountCanvas, readHexColor, startLoop, type Rgb } from "@/components/fx/gl";
import { readScroll } from "@/components/fx/scroll-store";
import { useFullEffects } from "@/components/fx/use-full-effects";
import { buildGhostForm, type GhostFormGeometry } from "@/lib/fx/ghost-form-geometry";
import { cn } from "@/lib/utils";

const VERTEX = `
attribute vec3 aTarget;
attribute vec3 aScatter;
attribute vec2 aInfo;
uniform float uTime;
uniform float uAssemble;
uniform float uRotate;
uniform float uTilt;
uniform float uAspect;
uniform float uScale;
uniform float uPixel;
varying float vAlpha;
varying float vKind;

void main() {
  float kind = aInfo.x;
  float seed = aInfo.y;
  // Seams and the stand arrive first; the surface cloud settles around them.
  float delay = seed * 0.45 + (kind < 0.5 ? 0.25 : 0.0);
  float k = clamp((uAssemble - delay) / 0.3, 0.0, 1.0);
  k = 1.0 - pow(1.0 - k, 3.0);
  vec3 p = mix(aScatter, aTarget, k);
  p.xz *= 1.0 + 0.014 * sin(uTime * 1.1 + p.y * 1.7);
  float drift = kind < 0.5 ? 0.006 : 0.0015;
  p += drift * vec3(sin(uTime * 0.7 + seed * 40.0), cos(uTime * 0.9 + seed * 31.0), sin(uTime * 0.8 + seed * 23.0));
  float c = cos(uRotate);
  float s = sin(uRotate);
  p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  float ct = cos(uTilt);
  float st = sin(uTilt);
  p = vec3(p.x, ct * p.y - st * p.z, st * p.y + ct * p.z);
  float perspective = 3.4 / (3.4 - p.z);
  gl_Position = vec4(p.x * perspective * uScale / uAspect, p.y * perspective * uScale, 0.0, 1.0);
  float size = kind > 1.5 ? 1.7 : (kind > 0.5 ? 2.3 : 1.6);
  gl_PointSize = size * uPixel * perspective;
  float twinkle = kind < 0.5 ? 0.75 + 0.25 * sin(uTime * 2.0 + seed * 60.0) : 1.0;
  float depth = clamp(0.55 + p.z * 0.9, 0.25, 1.0);
  float strength = kind > 1.5 ? 0.45 : (kind > 0.5 ? 0.85 : 0.3);
  vAlpha = strength * depth * twinkle * (0.35 + 0.65 * k);
  vKind = kind;
}
`;

const FRAGMENT = `
precision mediump float;
uniform vec3 uSurface;
uniform vec3 uSeam;
uniform vec3 uStand;
varying float vAlpha;
varying float vKind;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0) discard;
  float falloff = (1.0 - d) * (1.0 - d);
  vec3 color = vKind > 1.5 ? uStand : (vKind > 0.5 ? uSeam : uSurface);
  float alpha = falloff * vAlpha;
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

/** The form fits inside ±0.94 of the canvas height at this scale. */
const SCALE = 0.6;
const ASSEMBLE_SECONDS = 2.6;
/** The still pose for calm mode: a three-quarter view. */
const STILL = { rotate: 0.55, tilt: 0.05, time: 3 };

let sharedGeometry: GhostFormGeometry | null = null;

/** Turn per px scrolled when the form follows the scroll, and lean per unit of scroll speed. */
const SCROLL_TURN = 0.0032;
const SCROLL_LEAN = 0.28;

type Tone = { surface: Rgb; seam: Rgb; stand: Rgb };

/**
 * The studio's signature: an invisible display form drawn in points of light. It assembles from
 * scattered points, breathes, turns slowly and leans towards the pointer. Colours and blending
 * come from --form-tone / --form-* on the element, so it adapts to theme and to the index overlay;
 * colour changes glide rather than jump. With `spin="scroll"` it also turns as the page scrolls
 * and leans with the scroll speed. Change `tone` to make it re-read its colours (e.g. when the
 * wrapper's --form-* change).
 */
export function GhostForm({
  className,
  spin = "time",
  tone,
}: {
  className?: string;
  spin?: "time" | "scroll";
  tone?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const applyToneRef = useRef<(() => void) | null>(null);
  const full = useFullEffects();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const mounted = mountCanvas(host, {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: true,
      powerPreference: "low-power",
    });
    if (!mounted) return;
    const { canvas, gl, dispose } = mounted;
    const program = createProgram(gl, VERTEX, FRAGMENT);
    if (!program) {
      dispose();
      return;
    }
    gl.useProgram(program);
    sharedGeometry ??= buildGhostForm();
    const geometry = sharedGeometry;

    const bind = (name: string, data: Float32Array, size: number) => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    };
    bind("aTarget", geometry.target, 3);
    bind("aScatter", geometry.scatter, 3);
    bind("aInfo", geometry.info, 2);

    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const u = {
      time: uniform("uTime"),
      assemble: uniform("uAssemble"),
      rotate: uniform("uRotate"),
      tilt: uniform("uTilt"),
      aspect: uniform("uAspect"),
      scale: uniform("uScale"),
      pixel: uniform("uPixel"),
      surface: uniform("uSurface"),
      seam: uniform("uSeam"),
      stand: uniform("uStand"),
    };
    gl.uniform1f(u.scale, SCALE);
    gl.enable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);

    // Colours ease towards the target tone each frame; calm mode snaps to it.
    const target: Tone = {
      surface: [0.95, 0.94, 0.91],
      seam: [1, 0.72, 0.8],
      stand: [0.66, 0.74, 0.71],
    };
    const current: Tone = {
      surface: [...target.surface],
      seam: [...target.seam],
      stand: [...target.stand],
    };
    const uploadTone = () => {
      gl.uniform3fv(u.surface, current.surface);
      gl.uniform3fv(u.seam, current.seam);
      gl.uniform3fv(u.stand, current.stand);
    };
    const easeTone = (rate: number) => {
      let moving = false;
      for (const key of ["surface", "seam", "stand"] as const) {
        for (let i = 0; i < 3; i++) {
          const gap = target[key][i]! - current[key][i]!;
          if (Math.abs(gap) > 0.001) moving = true;
          current[key][i] = current[key][i]! + gap * rate;
        }
      }
      if (moving || rate === 1) uploadTone();
    };
    let toneRead = false;
    const applyTone = () => {
      const style = getComputedStyle(host);
      const glow = style.getPropertyValue("--form-tone").trim() !== "ink";
      // Light adds up on dark grounds; on light grounds the points are ink laid over paper.
      gl.blendFunc(gl.ONE, glow ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      target.surface = readHexColor(style, "--form-surface", target.surface);
      target.seam = readHexColor(style, "--form-seam", target.seam);
      target.stand = readHexColor(style, "--form-stand", target.stand);
      // The first read (and every read in calm mode) snaps; later changes glide.
      easeTone(!toneRead || !full ? 1 : 0);
      toneRead = true;
    };
    applyTone();
    applyToneRef.current = () => {
      applyTone();
      if (!full) renderStill();
    };

    const resize = () => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(host.clientWidth * pixelRatio));
      canvas.height = Math.max(1, Math.round(host.clientHeight * pixelRatio));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(u.aspect, canvas.width / canvas.height);
      gl.uniform1f(u.pixel, pixelRatio);
    };
    resize();

    const render = (time: number, assemble: number, rotate: number, tilt: number) => {
      gl.uniform1f(u.time, time);
      gl.uniform1f(u.assemble, assemble);
      gl.uniform1f(u.rotate, rotate);
      gl.uniform1f(u.tilt, tilt);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, geometry.count);
      canvas.style.opacity = "1";
    };
    const renderStill = () => render(STILL.time, 1, STILL.rotate, STILL.tilt);

    const pointer = { x: 0, y: 0 };
    const eased = { x: 0, y: 0 };
    const onPointerMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      pointer.x = Math.max(-1.5, Math.min(1.5, ((event.clientX - rect.left) / rect.width) * 2 - 1));
      pointer.y = Math.max(-1.5, Math.min(1.5, ((event.clientY - rect.top) / rect.height) * 2 - 1));
    };

    let visible = true;
    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    visibility.observe(host);

    const sizeObserver = new ResizeObserver(() => {
      resize();
      if (!full) renderStill();
    });
    sizeObserver.observe(host);
    const themeObserver = new MutationObserver(() => {
      applyTone();
      if (!full) renderStill();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    let stopLoop = () => {};
    if (full) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      const start = performance.now() / 1000;
      stopLoop = startLoop((seconds) => {
        if (!visible) return;
        const time = seconds - start;
        eased.x += (pointer.x - eased.x) * 0.05;
        eased.y += (pointer.y - eased.y) * 0.05;
        easeTone(0.06);
        const scroll = spin === "scroll" ? readScroll() : null;
        render(
          time,
          Math.min(1, time / ASSEMBLE_SECONDS),
          time * 0.22 + eased.x * 0.8 + (scroll ? scroll.y * SCROLL_TURN : 0),
          eased.y * 0.2 + (scroll ? scroll.velocity * SCROLL_LEAN : 0),
        );
      }, 60);
    } else {
      renderStill();
    }

    return () => {
      stopLoop();
      applyToneRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      visibility.disconnect();
      sizeObserver.disconnect();
      themeObserver.disconnect();
      dispose();
    };
  }, [full, spin]);

  // A new tone (e.g. the band behind the form changed): read the colours again.
  useEffect(() => {
    applyToneRef.current?.();
  }, [tone]);

  return <div ref={hostRef} aria-hidden className={cn("relative", className)} />;
}
