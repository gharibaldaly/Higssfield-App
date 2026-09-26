/** Minimal WebGL 1 helpers shared by the satin background and the ghost form. */

export type Rgb = [number, number, number];

/** Compiles and links a program; `attributes` get fixed locations (0, 1, …) so passes can share buffers. */
export function createProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
  attributes: string[] = [],
): WebGLProgram | null {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  attributes.forEach((name, index) => gl.bindAttribLocation(program, index, name));
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  gl.deleteProgram(program);
  return null;
}

/** Reads a `#rrggbb` custom property from computed style as linear 0–1 channels. */
export function readHexColor(style: CSSStyleDeclaration, name: string, fallback: Rgb): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(style.getPropertyValue(name).trim());
  if (!match) return fallback;
  const value = Number.parseInt(match[1]!, 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/**
 * Creates a canvas inside `host` with its own context. Each mount gets a fresh canvas, and
 * `dispose` releases the context, so remounts never reuse a lost context or pile up contexts.
 * With `preferWebGL2` a WebGL 2 context is tried first (float render targets for the fluid); the
 * shaders stay GLSL ES 1.0, which both versions run, so callers use the WebGL 1 API surface.
 */
export function mountCanvas(
  host: HTMLElement,
  attributes: WebGLContextAttributes,
  { preferWebGL2 = false }: { preferWebGL2?: boolean } = {},
): {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  webgl2: boolean;
  dispose: () => void;
} | null {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity 1.2s ease";
  const gl2 = preferWebGL2 ? canvas.getContext("webgl2", attributes) : null;
  const gl =
    (gl2 as unknown as WebGLRenderingContext | null) ?? canvas.getContext("webgl", attributes);
  if (!gl) return null;
  host.appendChild(canvas);
  return {
    canvas,
    gl,
    webgl2: gl2 !== null,
    dispose: () => {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    },
  };
}

/** A requestAnimationFrame loop capped at `fps`; browsers already pause it in hidden tabs. */
export function startLoop(draw: (seconds: number) => void, fps: number): () => void {
  const interval = 1000 / fps;
  let frame = 0;
  let last = -Infinity;
  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    if (now - last < interval - 2) return;
    last = now;
    draw(now / 1000);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
