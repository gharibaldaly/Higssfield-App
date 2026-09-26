"use client";

import { useEffect, useRef } from "react";

import { createFluid, type Fluid } from "@/components/fx/fluid";
import { createProgram, mountCanvas, readHexColor, startLoop, type Rgb } from "@/components/fx/gl";
import { readScroll } from "@/components/fx/scroll-store";
import { useFullEffects } from "@/components/fx/use-full-effects";

const VERTEX = `
attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

/*
 * Shot satin: a slowly folding height field lit from the top start corner. The sheen colour
 * shifts with the fold direction (shot silk: warp and weft in two colours), and the pointer
 * lifts the fabric where it rests. With the fluid running, its velocity field drags the folds
 * (the satin swirls behind the pointer and sloshes with the scroll) and its dye lays the sheen
 * colour into the swirls. The palette comes from --satin-* and is capped so text placed straight
 * on the satin keeps its contrast; the fluid only moves colours inside that palette.
 */
const FRAGMENT = `
precision mediump float;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uPointer;
uniform float uPress;
uniform vec3 uShade;
uniform vec3 uBase;
uniform vec3 uLight;
uniform vec3 uSheen;
uniform sampler2D uFlow;
uniform sampler2D uDye;
uniform float uFlowOn;

float folds(vec2 p, float t) {
  vec2 q = p + 0.3 * vec2(sin(p.y * 1.7 + t * 0.23), sin(p.x * 1.3 - t * 0.19));
  float v = sin(q.x * 1.6 + q.y * 0.9 + t * 0.31) * 0.6;
  v += sin(q.x * -0.8 + q.y * 2.2 - t * 0.24) * 0.32;
  v += sin((q.x + q.y) * 3.1 + t * 0.47) * 0.1;
  return v;
}

float height(vec2 p, float t) {
  vec2 d = p - uPointer;
  return folds(p, t) + uPress * 0.45 * exp(-dot(d, d) * 2.5);
}

float inkAt(vec2 uv) {
  return clamp(texture2D(uDye, uv).r, 0.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float aspect = uResolution.x / uResolution.y;
  float e = 0.02;
  // The dye lifts the fabric into ridges that catch the light; the flow drags the folds along.
  vec2 flow = vec2(0.0);
  vec3 ink = vec3(0.0);
  if (uFlowOn > 0.5) {
    vec2 step = vec2(e / (2.4 * aspect), e / 2.4);
    flow = texture2D(uFlow, uv).xy;
    ink = vec3(inkAt(uv), inkAt(uv + vec2(step.x, 0.0)), inkAt(uv + vec2(0.0, step.y)));
  }
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 2.4 - flow * 0.0022;
  float h = height(p, uTime) + ink.x * 0.4;
  float hx = height(p + vec2(e, 0.0), uTime) + ink.y * 0.4;
  float hy = height(p + vec2(0.0, e), uTime) + ink.z * 0.4;
  vec3 n = normalize(vec3((h - hx) / e, (h - hy) / e, 2.2));
  vec3 light = normalize(vec3(-0.45, 0.55, 0.7));
  float diffuse = clamp(dot(n, light), 0.0, 1.0);
  float spec = pow(clamp(dot(n, normalize(light + vec3(0.0, 0.0, 1.0))), 0.0, 1.0), 28.0);
  float shot = smoothstep(-0.5, 0.5, n.x - n.y * 0.6);
  vec3 color = mix(uShade, uBase, smoothstep(0.35, 1.0, diffuse));
  color = mix(color, mix(uLight, uSheen, shot), spec * 0.85);
  color = mix(color, uSheen, ink.x * 0.22);
  float vignette = smoothstep(1.25, 0.35, length((uv - 0.5) * vec2(aspect * 0.8, 1.0)));
  gl_FragColor = vec4(mix(uShade, color, 0.55 + 0.45 * vignette), 1.0);
}
`;

/** Render at half the CSS resolution: the satin is soft, and it keeps the GPU cool. */
const RENDER_SCALE = 0.5;
/** The still frame shown when effects are calm (a pleasant fold arrangement). */
const STILL_TIME = 14;
const FPS = 30;
/** Pointer travel (screen fractions per frame) to fluid force, and the dye each move lays down. */
const POINTER_FORCE = 5200;
const POINTER_DYE = 0.22;
/** Scroll speed (-1…1) to fluid force: the satin sloshes against the direction of travel. */
const SCROLL_FORCE = 520;
/** The solver rests once nothing has stirred it for this long. */
const REST_AFTER_S = 5;
const FINE_POINTER = "(pointer: fine)";

function readPalette(): Record<"shade" | "base" | "light" | "sheen", Rgb> {
  const style = getComputedStyle(document.documentElement);
  return {
    shade: readHexColor(style, "--satin-shade", [0.004, 0.04, 0.03]),
    base: readHexColor(style, "--satin-base", [0.02, 0.16, 0.13]),
    light: readHexColor(style, "--satin-light", [0.09, 0.29, 0.24]),
    sheen: readHexColor(style, "--satin-sheen", [0.32, 0.15, 0.23]),
  };
}

/** Fixed, full-screen WebGL satin behind the studio. Falls back to the flat background. */
export function SatinBackground() {
  const hostRef = useRef<HTMLDivElement>(null);
  const full = useFullEffects();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const mounted = mountCanvas(
      host,
      { alpha: false, antialias: false, depth: false, powerPreference: "low-power" },
      { preferWebGL2: full },
    );
    if (!mounted) return;
    const { canvas, gl, webgl2, dispose } = mounted;
    const program = createProgram(gl, VERTEX, FRAGMENT, ["aPosition"]);
    if (!program) {
      dispose();
      return;
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const u = {
      resolution: uniform("uResolution"),
      time: uniform("uTime"),
      pointer: uniform("uPointer"),
      press: uniform("uPress"),
      shade: uniform("uShade"),
      base: uniform("uBase"),
      light: uniform("uLight"),
      sheen: uniform("uSheen"),
      flow: uniform("uFlow"),
      dye: uniform("uDye"),
      flowOn: uniform("uFlowOn"),
    };

    const aspect = () => window.innerWidth / Math.max(1, window.innerHeight);
    const fluid: Fluid | null =
      full && window.matchMedia(FINE_POINTER).matches ? createFluid(gl, webgl2, aspect()) : null;
    gl.useProgram(program);
    gl.uniform1i(u.flow, 2);
    gl.uniform1i(u.dye, 3);
    gl.uniform1f(u.flowOn, fluid ? 1 : 0);

    const applyPalette = () => {
      const palette = readPalette();
      gl.useProgram(program);
      gl.uniform3fv(u.shade, palette.shade);
      gl.uniform3fv(u.base, palette.base);
      gl.uniform3fv(u.light, palette.light);
      gl.uniform3fv(u.sheen, palette.sheen);
    };
    applyPalette();

    const resize = () => {
      canvas.width = Math.max(1, Math.round(window.innerWidth * RENDER_SCALE));
      canvas.height = Math.max(1, Math.round(window.innerHeight * RENDER_SCALE));
      gl.useProgram(program);
      gl.uniform2f(u.resolution, canvas.width, canvas.height);
      fluid?.resize(aspect());
    };
    resize();

    // Pointer in the shader's fabric space, eased so the fabric follows softly.
    const pointer = { x: 0, y: 0, press: 0 };
    const eased = { x: 0, y: 0, press: 0 };
    // Pointer travel since the last frame, in screen fractions from the bottom left.
    const stir = { x: 0, y: 0, dx: 0, dy: 0, moved: false, seen: false };
    let lastStir = -Infinity;
    const onPointerMove = (event: PointerEvent) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      pointer.x = (event.clientX / width - 0.5) * (width / height) * 2.4;
      pointer.y = (0.5 - event.clientY / height) * 2.4;
      pointer.press = 1;
      if (!fluid || event.pointerType === "touch") return;
      const x = event.clientX / width;
      const y = 1 - event.clientY / height;
      if (stir.seen) {
        stir.dx += x - stir.x;
        stir.dy += y - stir.y;
        stir.moved = true;
      }
      stir.x = x;
      stir.y = y;
      stir.seen = true;
    };
    const onPointerLeave = () => {
      pointer.press = 0;
      stir.seen = false;
    };

    let last = 0;
    const draw = (seconds: number) => {
      if (fluid) {
        const dt = Math.min(1 / 15, Math.max(1 / 120, seconds - last || 1 / FPS));
        if (stir.moved) {
          fluid.splat(
            stir.x,
            stir.y,
            stir.dx * POINTER_FORCE,
            stir.dy * POINTER_FORCE,
            POINTER_DYE,
          );
          stir.dx = 0;
          stir.dy = 0;
          stir.moved = false;
          lastStir = seconds;
        }
        const { velocity } = readScroll();
        if (Math.abs(velocity) > 0.03) {
          const x = 0.15 + Math.random() * 0.7;
          const y = 0.2 + Math.random() * 0.6;
          fluid.splat(
            x,
            y,
            (Math.random() - 0.5) * 90 * Math.abs(velocity),
            velocity * SCROLL_FORCE,
            0,
          );
          lastStir = seconds;
        }
        if (seconds - lastStir < REST_AFTER_S) fluid.step(dt);
        fluid.bind(2, 3);
      }
      last = seconds;
      eased.x += (pointer.x - eased.x) * 0.06;
      eased.y += (pointer.y - eased.y) * 0.06;
      eased.press += (pointer.press - eased.press) * 0.04;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.uniform1f(u.time, seconds);
      gl.uniform2f(u.pointer, eased.x, eased.y);
      gl.uniform1f(u.press, eased.press);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      canvas.style.opacity = "1";
    };

    // Theme changes swap the palette; calm mode redraws its still frame.
    const themeObserver = new MutationObserver(() => {
      applyPalette();
      if (!full) draw(STILL_TIME);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    let stopLoop = () => {};
    const onResize = () => {
      resize();
      if (!full) draw(STILL_TIME);
    };
    window.addEventListener("resize", onResize);
    if (full) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onPointerLeave);
      const start = performance.now() / 1000 - STILL_TIME;
      stopLoop = startLoop((seconds) => draw(seconds - start), FPS);
    } else {
      draw(STILL_TIME);
    }

    return () => {
      stopLoop();
      themeObserver.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      fluid?.dispose();
      dispose();
    };
  }, [full]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background"
    >
      <div ref={hostRef} className="absolute inset-0" />
      {/* Film grain keeps large flat areas from banding. */}
      <div
        className="absolute inset-0 opacity-[0.05] mix-blend-overlay dark:opacity-[0.08]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />
    </div>
  );
}
