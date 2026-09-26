import "server-only";

import sharp, { type OverlayOptions } from "sharp";

import type {
  ImageVideoProvider,
  ModelSpec,
  ProviderState,
  StatusContext,
  SubmitContext,
} from "@/lib/providers/higgsfield/types";

/**
 * Mock image/video provider so the whole app works before Higgsfield
 * credentials exist (and in tests). Requests "complete" after a few seconds;
 * the result is a placeholder render built from the first isolated reference
 * image on the catalogue background. Videos are returned as still frames.
 */

const QUEUE_MS = 1500;
const IMAGE_MS = 6000;
const VIDEO_MS = 10000;

function parseRatio(value: unknown, fallback: number): number {
  if (typeof value !== "string") return fallback;
  const match = /^(\d+(?:\.\d+)?)[:x](\d+(?:\.\d+)?)$/.exec(value);
  if (!match) return fallback;
  const ratio = Number(match[1]) / Number(match[2]);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : fallback;
}

export async function renderPlaceholder(options: {
  ratio: number;
  reference: Buffer | null;
  accent: string;
  longEdge?: number;
}): Promise<Buffer> {
  const longEdge = options.longEdge ?? 1280;
  const width = Math.round(options.ratio >= 1 ? longEdge : longEdge * options.ratio);
  const height = Math.round(options.ratio >= 1 ? longEdge / options.ratio : longEdge);
  const base = sharp({
    create: { width, height, channels: 3, background: "#F7F3EE" },
  });
  const layers: OverlayOptions[] = [];
  if (options.reference) {
    try {
      const fitted = await sharp(options.reference)
        .rotate()
        .resize({
          width: Math.round(width * 0.84),
          height: Math.round(height * 0.84),
          fit: "inside",
          withoutEnlargement: false,
        })
        .toBuffer();
      layers.push({ input: fitted, gravity: "center" });
    } catch {
      // Unreadable reference: fall back to the plain canvas.
    }
  }
  const badge = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="${width - 150}" y="24" width="126" height="40" rx="20" fill="${options.accent}" fill-opacity="0.85"/>
      <circle cx="${width - 126}" cy="44" r="7" fill="#F7F3EE"/>
      <rect x="${width - 110}" y="38" width="70" height="12" rx="6" fill="#F7F3EE" fill-opacity="0.9"/>
      <rect x="0" y="${height - 10}" width="${width}" height="10" fill="${options.accent}" fill-opacity="0.6"/>
    </svg>`,
  );
  layers.push({ input: badge, top: 0, left: 0 });
  return base.composite(layers).png().toBuffer();
}

export class MockProvider implements ImageVideoProvider {
  readonly id = "mock" as const;

  async submit(
    _spec: ModelSpec,
    _body: Record<string, unknown>,
    context: SubmitContext,
  ): Promise<ProviderState> {
    return {
      requestId: `mock_${context.generationId}`,
      status: "queued",
      statusUrl: null,
      resultUrls: [],
      resultKind: null,
      cost: { amount: 0, unit: "credits" },
      error: null,
    };
  }

  async getStatus(requestId: string, context: StatusContext): Promise<ProviderState> {
    const started = context.submittedAt ? Date.parse(context.submittedAt) : Date.now();
    const elapsed = Date.now() - started;
    const doneAfter = context.kind === "video" ? VIDEO_MS : IMAGE_MS;
    const base: ProviderState = {
      requestId,
      status: elapsed < QUEUE_MS ? "queued" : "in_progress",
      statusUrl: null,
      resultUrls: [],
      resultKind: null,
      cost: { amount: 0, unit: "credits" },
      error: null,
    };
    if (elapsed < doneAfter) return base;

    const ratio = parseRatio(
      context.params.aspect_ratio,
      context.kind === "video" ? 9 / 16 : 4 / 5,
    );
    const reference = await context.loadReference().catch(() => null);
    const data = await renderPlaceholder({
      ratio,
      reference,
      accent: context.kind === "video" ? "#4D0011" : "#C9A66B",
    });
    return {
      ...base,
      status: "completed",
      resultKind: context.kind,
      resultBuffer: { data, mimeType: "image/png" },
    };
  }

  async cancel(): Promise<void> {
    // Nothing to cancel locally.
  }
}
