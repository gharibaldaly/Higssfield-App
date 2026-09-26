/**
 * A small stable-fluids solver (semi-Lagrangian advection, vorticity confinement, Jacobi
 * pressure) that lives inside the satin's WebGL context. The satin reads its velocity field to
 * displace the folds and its dye to add sheen, so the fabric swirls behind the pointer and
 * sloshes with the scroll. Needs half-float render targets with linear filtering (WebGL 2, or
 * WebGL 1 with the half-float extensions); without them it returns null and the satin stays calm.
 */

import { createProgram } from "@/components/fx/gl";

const VERTEX = `
precision highp float;
attribute vec2 aPosition;
uniform vec2 uTexel;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(uTexel.x, 0.0);
  vR = vUv + vec2(uTexel.x, 0.0);
  vT = vUv + vec2(0.0, uTexel.y);
  vB = vUv - vec2(0.0, uTexel.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const HEADER = `
precision highp float;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
`;

const SPLAT = `${HEADER}
uniform sampler2D uTarget;
uniform float uAspect;
uniform vec3 uColor;
uniform vec2 uPoint;
uniform float uRadius;
void main() {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  vec3 splat = exp(-dot(p, p) / uRadius) * uColor;
  gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + splat, 1.0);
}
`;

const ADVECT = `${HEADER}
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uSimTexel;
uniform float uDt;
uniform float uDissipation;
void main() {
  vec2 coord = vUv - uDt * texture2D(uVelocity, vUv).xy * uSimTexel;
  gl_FragColor = texture2D(uSource, coord) / (1.0 + uDissipation * uDt);
}
`;

const DIVERGENCE = `${HEADER}
uniform sampler2D uVelocity;
void main() {
  float L = texture2D(uVelocity, vL).x;
  float R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y;
  float B = texture2D(uVelocity, vB).y;
  vec2 C = texture2D(uVelocity, vUv).xy;
  if (vL.x < 0.0) { L = -C.x; }
  if (vR.x > 1.0) { R = -C.x; }
  if (vT.y > 1.0) { T = -C.y; }
  if (vB.y < 0.0) { B = -C.y; }
  gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}
`;

const CURL = `${HEADER}
uniform sampler2D uVelocity;
void main() {
  float L = texture2D(uVelocity, vL).y;
  float R = texture2D(uVelocity, vR).y;
  float T = texture2D(uVelocity, vT).x;
  float B = texture2D(uVelocity, vB).x;
  gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}
`;

const VORTICITY = `${HEADER}
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float uStrength;
uniform float uDt;
void main() {
  float L = texture2D(uCurl, vL).x;
  float R = texture2D(uCurl, vR).x;
  float T = texture2D(uCurl, vT).x;
  float B = texture2D(uCurl, vB).x;
  float C = texture2D(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= uStrength * C;
  force.y *= -1.0;
  vec2 velocity = texture2D(uVelocity, vUv).xy + force * uDt;
  gl_FragColor = vec4(clamp(velocity, -1000.0, 1000.0), 0.0, 1.0);
}
`;

const PRESSURE = `${HEADER}
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main() {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  float divergence = texture2D(uDivergence, vUv).x;
  gl_FragColor = vec4((L + R + B + T - divergence) * 0.25, 0.0, 0.0, 1.0);
}
`;

const SCALE = `${HEADER}
uniform sampler2D uSource;
uniform float uValue;
void main() {
  gl_FragColor = uValue * texture2D(uSource, vUv);
}
`;

const GRADIENT = `${HEADER}
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main() {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  vec2 velocity = texture2D(uVelocity, vUv).xy - vec2(R - L, T - B);
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`;

/** Tuned after sloshseltzer.com's mouse fluid (velocity 0.98, density 0.97, pressure 0.8, curl 30). */
const SETTINGS = {
  simSize: 128,
  dyeSize: 256,
  velocityDissipation: 0.6,
  dyeDissipation: 0.9,
  pressureKeep: 0.8,
  iterations: 8,
  curl: 26,
  radius: 0.0024,
};

type Target = {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
};

type Pair = { read: Target; write: Target; swap: () => void };

type Format = { internal: number; format: number; type: number };

export type Fluid = {
  /** Pushes the liquid at (x, y), 0–1 from the bottom left; force in texels per second. */
  splat: (x: number, y: number, forceX: number, forceY: number, dye: number) => void;
  step: (dt: number) => void;
  /** Binds the velocity and dye fields to texture units for the display pass. */
  bind: (velocityUnit: number, dyeUnit: number) => void;
  resize: (aspect: number) => void;
  dispose: () => void;
};

function halfFloatFormat(gl: WebGLRenderingContext, webgl2: boolean): Format | null {
  if (webgl2) {
    const gl2 = gl as unknown as WebGL2RenderingContext;
    if (
      !gl2.getExtension("EXT_color_buffer_float") &&
      !gl2.getExtension("EXT_color_buffer_half_float")
    ) {
      return null;
    }
    return { internal: gl2.RGBA16F, format: gl2.RGBA, type: gl2.HALF_FLOAT };
  }
  const half = gl.getExtension("OES_texture_half_float");
  if (!half || !gl.getExtension("OES_texture_half_float_linear")) return null;
  gl.getExtension("EXT_color_buffer_half_float");
  return { internal: gl.RGBA, format: gl.RGBA, type: half.HALF_FLOAT_OES };
}

function sizeFor(size: number, aspect: number): { width: number; height: number } {
  const wide = aspect >= 1;
  const long = Math.round(size * (wide ? aspect : 1 / aspect));
  return wide ? { width: long, height: size } : { width: size, height: long };
}

export function createFluid(
  gl: WebGLRenderingContext,
  webgl2: boolean,
  initialAspect: number,
): Fluid | null {
  const format = halfFloatFormat(gl, webgl2);
  if (!format) return null;

  const compile = (fragment: string) => createProgram(gl, VERTEX, fragment, ["aPosition"]);
  const sources = {
    splat: SPLAT,
    advect: ADVECT,
    divergence: DIVERGENCE,
    curl: CURL,
    vorticity: VORTICITY,
    pressure: PRESSURE,
    scale: SCALE,
    gradient: GRADIENT,
  };
  const programs = {} as Record<keyof typeof sources, WebGLProgram>;
  for (const [name, source] of Object.entries(sources) as [keyof typeof sources, string][]) {
    const program = compile(source);
    if (!program) {
      for (const built of Object.values(programs)) gl.deleteProgram(built);
      return null;
    }
    programs[name] = program;
  }

  const locations = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  const uniform = (program: WebGLProgram, name: string) => {
    let table = locations.get(program);
    if (!table) {
      table = new Map();
      locations.set(program, table);
    }
    if (!table.has(name)) table.set(name, gl.getUniformLocation(program, name));
    return table.get(name) ?? null;
  };

  const created: Target[] = [];
  const createTarget = (width: number, height: number): Target | null => {
    const texture = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!texture || !fbo) return null;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      format.internal,
      width,
      height,
      0,
      format.format,
      format.type,
      null,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (complete) {
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!complete) {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(fbo);
      return null;
    }
    const target = { texture, fbo, width, height };
    created.push(target);
    return target;
  };
  const createPair = (width: number, height: number): Pair | null => {
    const a = createTarget(width, height);
    const b = a && createTarget(width, height);
    if (!a || !b) return null;
    const pair: Pair = {
      read: a,
      write: b,
      swap: () => {
        const read = pair.read;
        pair.read = pair.write;
        pair.write = read;
      },
    };
    return pair;
  };
  const release = () => {
    for (const target of created.splice(0)) {
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.fbo);
    }
  };

  type Fields = {
    velocity: Pair;
    dye: Pair;
    pressure: Pair;
    divergence: Target;
    curl: Target;
  };
  let aspect = initialAspect;
  const build = (): Fields | null => {
    const sim = sizeFor(SETTINGS.simSize, aspect);
    const dyeSize = sizeFor(SETTINGS.dyeSize, aspect);
    const velocity = createPair(sim.width, sim.height);
    const dye = createPair(dyeSize.width, dyeSize.height);
    const pressure = createPair(sim.width, sim.height);
    const divergence = createTarget(sim.width, sim.height);
    const curl = createTarget(sim.width, sim.height);
    if (!velocity || !dye || !pressure || !divergence || !curl) return null;
    return { velocity, dye, pressure, divergence, curl };
  };
  let fields = build();
  if (!fields) {
    release();
    for (const program of Object.values(programs)) gl.deleteProgram(program);
    return null;
  }

  const texture = (unit: number, target: Target) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    return unit;
  };
  const draw = (target: Target) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.width, target.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const begin = (program: WebGLProgram, texel: Target) => {
    gl.useProgram(program);
    gl.uniform2f(uniform(program, "uTexel"), 1 / texel.width, 1 / texel.height);
    return program;
  };

  return {
    splat(x, y, forceX, forceY, dye) {
      if (!fields) return;
      const { velocity, dye: ink } = fields;
      const program = begin(programs.splat, velocity.read);
      gl.disable(gl.BLEND);
      gl.uniform1f(uniform(program, "uAspect"), aspect);
      gl.uniform2f(uniform(program, "uPoint"), x, y);
      gl.uniform1f(uniform(program, "uRadius"), SETTINGS.radius * Math.max(1, aspect));
      gl.uniform1i(uniform(program, "uTarget"), texture(0, velocity.read));
      gl.uniform3f(uniform(program, "uColor"), forceX, forceY, 0);
      draw(velocity.write);
      velocity.swap();
      if (dye > 0) {
        gl.uniform1i(uniform(program, "uTarget"), texture(0, ink.read));
        gl.uniform3f(uniform(program, "uColor"), dye, dye, dye);
        draw(ink.write);
        ink.swap();
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    step(dt) {
      if (!fields) return;
      const { velocity, dye, pressure, divergence, curl } = fields;
      gl.disable(gl.BLEND);

      let program = begin(programs.curl, velocity.read);
      gl.uniform1i(uniform(program, "uVelocity"), texture(0, velocity.read));
      draw(curl);

      program = begin(programs.vorticity, velocity.read);
      gl.uniform1i(uniform(program, "uVelocity"), texture(0, velocity.read));
      gl.uniform1i(uniform(program, "uCurl"), texture(1, curl));
      gl.uniform1f(uniform(program, "uStrength"), SETTINGS.curl);
      gl.uniform1f(uniform(program, "uDt"), dt);
      draw(velocity.write);
      velocity.swap();

      program = begin(programs.divergence, velocity.read);
      gl.uniform1i(uniform(program, "uVelocity"), texture(0, velocity.read));
      draw(divergence);

      program = begin(programs.scale, pressure.read);
      gl.uniform1i(uniform(program, "uSource"), texture(0, pressure.read));
      gl.uniform1f(uniform(program, "uValue"), SETTINGS.pressureKeep);
      draw(pressure.write);
      pressure.swap();

      program = begin(programs.pressure, pressure.read);
      gl.uniform1i(uniform(program, "uDivergence"), texture(0, divergence));
      for (let i = 0; i < SETTINGS.iterations; i++) {
        gl.uniform1i(uniform(program, "uPressure"), texture(1, pressure.read));
        draw(pressure.write);
        pressure.swap();
      }

      program = begin(programs.gradient, velocity.read);
      gl.uniform1i(uniform(program, "uPressure"), texture(0, pressure.read));
      gl.uniform1i(uniform(program, "uVelocity"), texture(1, velocity.read));
      draw(velocity.write);
      velocity.swap();

      program = begin(programs.advect, velocity.read);
      gl.uniform2f(
        uniform(program, "uSimTexel"),
        1 / velocity.read.width,
        1 / velocity.read.height,
      );
      gl.uniform1f(uniform(program, "uDt"), dt);
      gl.uniform1i(uniform(program, "uVelocity"), texture(0, velocity.read));
      gl.uniform1i(uniform(program, "uSource"), texture(0, velocity.read));
      gl.uniform1f(uniform(program, "uDissipation"), SETTINGS.velocityDissipation);
      draw(velocity.write);
      velocity.swap();

      gl.uniform1i(uniform(program, "uVelocity"), texture(0, velocity.read));
      gl.uniform1i(uniform(program, "uSource"), texture(1, dye.read));
      gl.uniform1f(uniform(program, "uDissipation"), SETTINGS.dyeDissipation);
      draw(dye.write);
      dye.swap();

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    bind(velocityUnit, dyeUnit) {
      if (!fields) return;
      texture(velocityUnit, fields.velocity.read);
      texture(dyeUnit, fields.dye.read);
    },

    resize(nextAspect) {
      if (Math.abs(nextAspect - aspect) < 0.01) return;
      aspect = nextAspect;
      release();
      fields = build();
    },

    dispose() {
      release();
      fields = null;
      for (const program of Object.values(programs)) gl.deleteProgram(program);
    },
  };
}
