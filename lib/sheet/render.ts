import "server-only";

import path from "node:path";

import sharp, { type OverlayOptions, type Sharp } from "sharp";

import { SHEET_DESIGN } from "@/lib/domain/sheet";
import { pixelRect } from "@/lib/sheet/boxes";
import type { CardSource, ComposedCard, ComposedLayout, NormalizedRect } from "@/lib/sheet/layout";

/** The board is rendered at 4K UHD, the highest resolution the sheet needs. */
export const BOARD = { width: 3840, height: 2160 } as const;

/**
 * IBM Plex Sans Arabic (SIL Open Font License, assets/fonts/OFL.txt) has Latin
 * and Arabic glyphs. The files are traced into the sheet route's function
 * (next.config.ts), because a serverless function has no system fonts.
 */
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const FONTS = {
  regular: {
    file: path.join(FONT_DIR, "IBMPlexSansArabic-Regular.ttf"),
    family: "IBM Plex Sans Arabic",
  },
  semibold: {
    file: path.join(FONT_DIR, "IBMPlexSansArabic-SemiBold.ttf"),
    family: "IBM Plex Sans Arabic SmBld",
  },
} as const;

/** A photo ready to cut: its bytes and its size after EXIF rotation. */
export type SourceImage = { data: Buffer; width: number; height: number };

export async function describeSource(data: Buffer): Promise<SourceImage> {
  const meta = await sharp(data).metadata();
  if (!meta.width || !meta.height) throw new Error("Unreadable image");
  // EXIF orientations 5–8 swap width and height once rotated.
  const swap = (meta.orientation ?? 1) >= 5;
  return {
    data,
    width: swap ? meta.height : meta.width,
    height: swap ? meta.width : meta.height,
  };
}

/** The region of a photo, upright, as a sharp pipeline. */
function cut(source: SourceImage, box: NormalizedRect) {
  return sharp(source.data)
    .rotate()
    .extract(pixelRect(box, source.width, source.height));
}

const escapeMarkup = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

type TextOptions = {
  font: keyof typeof FONTS;
  size: number;
  colour: string;
  width: number;
  align?: "left" | "centre";
  lineSpacing?: number;
};

/** Text rendered by Pango (Arabic joins and bidi included), with a transparent background. */
async function renderText(text: string, options: TextOptions) {
  const font = FONTS[options.font];
  return sharp({
    text: {
      text: `<span foreground="${options.colour}">${escapeMarkup(text)}</span>`,
      font: `${font.family} ${options.size}`,
      fontfile: font.file,
      width: Math.max(1, Math.round(options.width)),
      align: options.align ?? "left",
      wrap: "word",
      rgba: true,
      dpi: 72,
      spacing: options.lineSpacing ?? 0,
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
}

/** Text that fits a box: the size steps down until it does. */
async function fittedText(text: string, options: TextOptions, maxHeight: number) {
  let size = options.size;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const rendered = await renderText(text, { ...options, size });
    if (rendered.info.height <= maxHeight || attempt === 5) return rendered;
    size = Math.round(size * 0.88);
  }
  throw new Error("unreachable");
}

function roundedMask(width: number, height: number, radius: number): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" ry="${radius}"/></svg>`,
  );
}

type Box = { left: number; top: number; width: number; height: number };

function toPixels(rect: NormalizedRect): Box {
  return {
    left: Math.round(rect.x * BOARD.width),
    top: Math.round(rect.y * BOARD.height),
    width: Math.round(rect.w * BOARD.width),
    height: Math.round(rect.h * BOARD.height),
  };
}

/** Fills a card edge to edge (details, fabrics) or shows all of it (views, the set). */
const FILLS = new Set(["detail", "swatch"]);

/**
 * One card's image at a given size: a single region, or a set's pieces side
 * by side. Regions are cut from the full-resolution photo, then scaled.
 */
async function cardImage(
  card: ComposedCard,
  sources: Map<string, SourceImage>,
  size: { width: number; height: number },
  background: string,
): Promise<Buffer | null> {
  const parts = card.sources.flatMap((source: CardSource) => {
    const image = sources.get(source.path);
    return image ? [{ image, box: source.box }] : [];
  });
  if (parts.length === 0) return null;
  const fill = FILLS.has(card.cropKind ?? "");
  if (parts.length === 1) {
    const [{ image, box }] = parts as [(typeof parts)[number]];
    return cut(image, box)
      .resize(size.width, size.height, {
        fit: fill ? "cover" : "contain",
        background,
      })
      .flatten({ background })
      .png()
      .toBuffer();
  }
  // A set: every piece in its own column.
  const gap = Math.round(size.width * 0.03);
  const columnWidth = Math.floor((size.width - gap * (parts.length - 1)) / parts.length);
  const columns = await Promise.all(
    parts.map(({ image, box }) =>
      cut(image, box)
        .resize(columnWidth, size.height, { fit: "contain", background })
        .flatten({ background })
        .png()
        .toBuffer(),
    ),
  );
  return sharp({
    create: { width: size.width, height: size.height, channels: 3, background },
  })
    .composite(
      columns.map((input, index) => ({ input, left: index * (columnWidth + gap), top: 0 })),
    )
    .png()
    .toBuffer();
}

export type BoardText = { title: string; bullets: string[]; missingImage: string };

/**
 * Renders the product sheet from the owner's photos: warm off-white board,
 * white rounded cards with soft shadows, charcoal headings, grey body text
 * and a thin gold rule (the project's sheet design). Nothing is redrawn:
 * every garment image is a region of a photo, scaled.
 */
export async function renderBoard(
  layout: ComposedLayout,
  text: BoardText,
  sources: Map<string, SourceImage>,
): Promise<{ data: Buffer; width: number; height: number }> {
  const scale = BOARD.width / 1600;
  const radius = Math.round(12 * scale);
  const imageRadius = Math.round(8 * scale);
  const labelSize = Math.round(13 * scale);

  const cardShapes: string[] = [];
  const shadowShapes: string[] = [];
  const shadowOffset = Math.round(4 * scale);
  const layers: OverlayOptions[] = [];

  for (const card of layout.cards) {
    const box = toPixels(card.rect);
    if (card.role === "title") {
      const title = await fittedText(
        text.title,
        {
          font: "semibold",
          size: Math.round(30 * scale),
          colour: SHEET_DESIGN.heading,
          width: box.width,
        },
        box.height - Math.round(10 * scale),
      );
      layers.push({ input: title.data, left: box.left, top: box.top });
      cardShapes.push(
        `<rect x="${box.left}" y="${box.top + box.height - Math.round(3 * scale)}" width="${box.width}" height="${Math.max(2, Math.round(1.2 * scale))}" fill="${SHEET_DESIGN.accent}"/>`,
      );
      continue;
    }

    cardShapes.push(
      `<rect x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" rx="${radius}" ry="${radius}" fill="${SHEET_DESIGN.card}"/>`,
    );
    shadowShapes.push(
      `<rect x="${box.left}" y="${box.top + shadowOffset}" width="${box.width}" height="${box.height}" rx="${radius}" ry="${radius}"/>`,
    );

    if (card.role === "bullets") {
      const padding = Math.round(18 * scale);
      const bullets = await fittedText(
        text.bullets.map((bullet) => `•  ${bullet}`).join("\n"),
        {
          font: "regular",
          size: Math.round(14 * scale),
          colour: SHEET_DESIGN.body,
          width: box.width - padding * 2,
          lineSpacing: Math.round(10 * scale),
        },
        box.height - padding * 2,
      );
      layers.push({ input: bullets.data, left: box.left + padding, top: box.top + padding });
      continue;
    }

    if (!card.imageRect) continue;
    const area = toPixels(card.imageRect);
    const image = await cardImage(card, sources, area, SHEET_DESIGN.card);
    if (image) {
      const rounded = await sharp(image)
        .ensureAlpha()
        .composite([{ input: roundedMask(area.width, area.height, imageRadius), blend: "dest-in" }])
        .png()
        .toBuffer();
      layers.push({ input: rounded, left: area.left, top: area.top });
    } else {
      const note = await renderText(text.missingImage, {
        font: "regular",
        size: labelSize,
        colour: SHEET_DESIGN.body,
        width: area.width,
        align: "centre",
      });
      layers.push({
        input: note.data,
        left: area.left + Math.max(0, Math.round((area.width - note.info.width) / 2)),
        top: area.top + Math.max(0, Math.round((area.height - note.info.height) / 2)),
      });
    }

    // The label sits in the band under the image (none on the hero card).
    const band = box.top + box.height - (area.top + area.height);
    if (card.label && card.role !== "hero" && band > labelSize) {
      // Aligned with the image's edge above it.
      const label = await fittedText(
        card.label,
        { font: "semibold", size: labelSize, colour: SHEET_DESIGN.heading, width: area.width },
        band,
      );
      layers.push({
        input: label.data,
        left: area.left,
        top: area.top + area.height + Math.max(0, Math.round((band - label.info.height) / 2)),
      });
    }
  }

  const svg = (shapes: string[], attributes = "") =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${BOARD.width}" height="${BOARD.height}"${attributes}>${shapes.join("")}</svg>`,
    );
  // Soft shadows: the cards' shapes, faint and blurred by libvips (an SVG blur
  // filter at this size takes seconds).
  const shadow = await sharp(
    svg(shadowShapes, ` fill="${SHEET_DESIGN.heading}" fill-opacity="0.08"`),
  )
    .blur(Math.round(8 * scale))
    .png()
    .toBuffer();

  const data = await sharp({
    create: {
      width: BOARD.width,
      height: BOARD.height,
      channels: 3,
      background: SHEET_DESIGN.background,
    },
  })
    .composite([
      { input: shadow, left: 0, top: 0 },
      { input: svg(cardShapes), left: 0, top: 0 },
      ...layers,
    ])
    .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toBuffer();
  return { data, width: BOARD.width, height: BOARD.height };
}

/** Longest side of a reference crop; image and video models scale larger inputs down anyway. */
const CROP_EDGE = 2560;

/**
 * A card's reference image for the ads, cut from the full-resolution photo:
 * the region itself (no board, no rounding), or a set's pieces side by side.
 */
export async function cutCardReference(
  card: ComposedCard,
  sources: Map<string, SourceImage>,
): Promise<{ data: Buffer; width: number; height: number } | null> {
  const parts = card.sources.flatMap((source) => {
    const image = sources.get(source.path);
    return image ? [{ image, box: source.box }] : [];
  });
  if (parts.length === 0) return null;
  let pipeline: Sharp;
  if (parts.length === 1) {
    const [{ image, box }] = parts as [(typeof parts)[number]];
    pipeline = cut(image, box).resize(CROP_EDGE, CROP_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    });
  } else {
    const height = 1800;
    const gap = 48;
    const columns = await Promise.all(
      parts.map(({ image, box }) =>
        cut(image, box).resize({ height, withoutEnlargement: false }).png().toBuffer({
          resolveWithObject: true,
        }),
      ),
    );
    const width =
      columns.reduce((sum, column) => sum + column.info.width, 0) + gap * (parts.length - 1);
    let left = 0;
    pipeline = sharp({ create: { width, height, channels: 3, background: "#FFFFFF" } }).composite(
      columns.map((column) => {
        const layer = { input: column.data, left, top: 0 };
        left += column.info.width + gap;
        return layer;
      }),
    );
    pipeline = sharp(await pipeline.png().toBuffer()).resize(CROP_EDGE, CROP_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  const { data, info } = await pipeline
    .flatten({ background: "#FFFFFF" })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
