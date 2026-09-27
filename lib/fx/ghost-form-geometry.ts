/**
 * Point cloud for the studio's signature visual: an invisible display form drawn in light.
 * A sparse cloud traces the surface, denser rows mark the seam lines a pattern maker would
 * (hem, hip, waist, chest line, neckline; side and princess seams), and the stand sits below.
 * Coordinates: y up, +z towards the viewer, centred on the origin. Deterministic per seed.
 */

export const POINT_KIND = { surface: 0, seam: 1, stand: 2 } as const;

/** Torso profile from hem to neck top: [y, half-width (x), half-depth (z)]. */
const PROFILE: readonly (readonly [number, number, number])[] = [
  [-0.85, 0.39, 0.265],
  [-0.62, 0.425, 0.285],
  [-0.32, 0.375, 0.255],
  [0.05, 0.3, 0.205],
  [0.34, 0.355, 0.235],
  [0.56, 0.395, 0.255],
  [0.74, 0.415, 0.225],
  [0.86, 0.35, 0.17],
  [0.93, 0.19, 0.125],
  [0.97, 0.12, 0.1],
  [1.1, 0.11, 0.095],
];

const HEM_Y = -0.85;
const NECK_TOP_Y = 1.1;
const FLOOR_Y = -1.8;
/** Shifts the whole form so the stand's foot and the neck cap sit symmetric around y = 0. */
export const CENTER_Y = (FLOOR_Y + NECK_TOP_Y + 0.06) / 2;

/** Seam rows (horizontal) and seam angles (vertical, 0 = centre front). */
const RING_HEIGHTS = [-0.85, -0.62, 0.05, 0.56, 0.97, 1.1];
const SEAM_ANGLES = [0.62, -0.62, Math.PI / 2, -Math.PI / 2, Math.PI - 0.62, -(Math.PI - 0.62)];
/** Where the vertical seams stop: just under the shoulder slope. */
const SEAM_TOP_Y = 0.88;

export type GhostFormGeometry = {
  count: number;
  /** xyz of each point on the finished form. */
  target: Float32Array;
  /** xyz of each point before the form assembles. */
  scatter: Float32Array;
  /** Per point: kind (POINT_KIND) and a random value in [0, 1). */
  info: Float32Array;
};

export type GhostFormOptions = {
  seed?: number;
  surfacePoints?: number;
  pointsPerRing?: number;
  pointsPerSeam?: number;
};

/** Half-width and half-depth of the torso at height y (cosine-eased between profile rows). */
export function profileAt(y: number): { rx: number; rz: number } {
  const first = PROFILE[0]!;
  const last = PROFILE[PROFILE.length - 1]!;
  if (y <= first[0]) return { rx: first[1], rz: first[2] };
  if (y >= last[0]) return { rx: last[1], rz: last[2] };
  for (let index = 1; index < PROFILE.length; index += 1) {
    const upper = PROFILE[index]!;
    if (y > upper[0]) continue;
    const lower = PROFILE[index - 1]!;
    const t = (y - lower[0]) / (upper[0] - lower[0]);
    const eased = (1 - Math.cos(t * Math.PI)) / 2;
    return {
      rx: lower[1] + (upper[1] - lower[1]) * eased,
      rz: lower[2] + (upper[2] - lower[2]) * eased,
    };
  }
  return { rx: last[1], rz: last[2] };
}

/** Small, fast, seedable PRNG (mulberry32). */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ramanujan's approximation of an ellipse perimeter, used to spread surface points evenly. */
function perimeter(rx: number, rz: number): number {
  return Math.PI * (3 * (rx + rz) - Math.sqrt((3 * rx + rz) * (rx + 3 * rz)));
}

export function buildGhostForm(options: GhostFormOptions = {}): GhostFormGeometry {
  const random = createRandom(options.seed ?? 20260925);
  const surfacePoints = options.surfacePoints ?? 9000;
  const pointsPerRing = options.pointsPerRing ?? 400;
  const pointsPerSeam = options.pointsPerSeam ?? 360;

  const target: number[] = [];
  const info: number[] = [];
  const push = (x: number, y: number, z: number, kind: number) => {
    target.push(x, y - CENTER_Y, z);
    info.push(kind, random());
  };
  const onSurface = (y: number, angle: number, jitter: number) => {
    const { rx, rz } = profileAt(y);
    const scale = 1 + (random() - 0.5) * jitter;
    return [Math.sin(angle) * rx * scale, Math.cos(angle) * rz * scale] as const;
  };

  // Surface: rejection-sample height by girth so wide rows are not starved of points.
  const maxGirth = perimeter(0.425, 0.285);
  let placed = 0;
  while (placed < surfacePoints) {
    const y = HEM_Y + random() * (NECK_TOP_Y - HEM_Y);
    const { rx, rz } = profileAt(y);
    if (random() * maxGirth > perimeter(rx, rz)) continue;
    const [x, z] = onSurface(y, random() * Math.PI * 2, 0.035);
    push(x, y, z, POINT_KIND.surface);
    placed += 1;
  }

  for (const y of RING_HEIGHTS) {
    for (let index = 0; index < pointsPerRing; index += 1) {
      const angle = (index / pointsPerRing) * Math.PI * 2 + random() * 0.01;
      const [x, z] = onSurface(y + (random() - 0.5) * 0.008, angle, 0.01);
      push(x, y, z, POINT_KIND.seam);
    }
  }

  for (const angle of SEAM_ANGLES) {
    for (let index = 0; index < pointsPerSeam; index += 1) {
      const y = HEM_Y + (index / pointsPerSeam) * (SEAM_TOP_Y - HEM_Y);
      const [x, z] = onSurface(y, angle + (random() - 0.5) * 0.02, 0.01);
      push(x, y, z, POINT_KIND.seam);
    }
  }

  // Neck cap (a filled disc) and its knob.
  const cap = profileAt(NECK_TOP_Y);
  for (let index = 0; index < 220; index += 1) {
    const radius = Math.sqrt(random());
    const angle = random() * Math.PI * 2;
    push(
      Math.sin(angle) * cap.rx * radius,
      NECK_TOP_Y,
      Math.cos(angle) * cap.rz * radius,
      POINT_KIND.surface,
    );
  }
  for (let index = 0; index < 60; index += 1) {
    const angle = (index / 60) * Math.PI * 2;
    push(Math.sin(angle) * 0.035, NECK_TOP_Y + 0.06, Math.cos(angle) * 0.035, POINT_KIND.stand);
  }

  // Stand: pole, collar, three legs with small feet.
  const poleTop = HEM_Y - 0.01;
  const poleBottom = FLOOR_Y + 0.08;
  for (let index = 0; index < 420; index += 1) {
    const y = poleBottom + random() * (poleTop - poleBottom);
    const angle = random() * Math.PI * 2;
    push(Math.sin(angle) * 0.022, y, Math.cos(angle) * 0.022, POINT_KIND.stand);
  }
  for (let index = 0; index < 90; index += 1) {
    const angle = (index / 90) * Math.PI * 2;
    push(Math.sin(angle) * 0.07, HEM_Y - 0.05, Math.cos(angle) * 0.07, POINT_KIND.stand);
  }
  for (let leg = 0; leg < 3; leg += 1) {
    const angle = (leg / 3) * Math.PI * 2 + Math.PI / 6;
    const footX = Math.sin(angle) * 0.46;
    const footZ = Math.cos(angle) * 0.46;
    for (let index = 0; index < 140; index += 1) {
      const t = index / 139;
      push(footX * t, poleBottom + (FLOOR_Y - poleBottom) * t, footZ * t, POINT_KIND.stand);
    }
    for (let index = 0; index < 30; index += 1) {
      const around = (index / 30) * Math.PI * 2;
      push(
        footX + Math.sin(around) * 0.03,
        FLOOR_Y,
        footZ + Math.cos(around) * 0.03,
        POINT_KIND.stand,
      );
    }
  }

  // Before assembly every point floats in a loose shell around the form.
  const count = target.length / 3;
  const scatter = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const u = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const radius = 1.5 + random() * 2;
    const ring = Math.sqrt(1 - u * u);
    scatter[index * 3] = Math.cos(angle) * ring * radius;
    scatter[index * 3 + 1] = u * radius * 0.8;
    scatter[index * 3 + 2] = Math.sin(angle) * ring * radius;
  }

  return {
    count,
    target: new Float32Array(target),
    scatter,
    info: new Float32Array(info),
  };
}
