import type { SheetPhotoPlan } from "@/lib/domain/sheet";
import { FULL_RECT, fitRectToAspect, padRect, rectFromBrainBox } from "@/lib/sheet/boxes";
import {
  computeSheetLayout,
  type CardSource,
  type ComposedCard,
  type ComposedLayout,
  type NormalizedRect,
  type SheetCard,
} from "@/lib/sheet/layout";

/** A photo the brain was shown; its number is its position in the list plus one. */
export type SheetPhoto = {
  path: string;
  kind: "front" | "back" | "detail";
  pieceId: string;
  /** Width / height of the photo as shown, after EXIF rotation. */
  aspect: number;
};

export type ComposeInput = {
  plan: SheetPhotoPlan;
  photos: SheetPhoto[];
  /** Approved catalogue images replace the photos for their view. */
  approved: { front: string | null; back: string | null };
  /** One front photo per piece, for a set's "pieces" card. */
  pieceFronts: string[];
  /** The board's size in pixels, for the shape of each card. */
  canvas: { width: number; height: number };
};

/** A detail the brain boxed off the photo gets this much room around it. */
const DETAIL_PADDING = 0.06;
const VIEW_PADDING = 0.03;
/** Where to look when the brain's box is unusable: the middle of the photo. */
const CENTRE: NormalizedRect = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };

/**
 * Turns the brain's plan into a sheet layout whose image cards name the
 * photo regions they show. Anything the brain got wrong (a photo number that
 * does not exist, an empty box) falls back to something real and is listed
 * in `warnings`, so the owner knows which cards to check.
 */
export function composeSheetLayout(input: ComposeInput): {
  layout: ComposedLayout;
  warnings: string[];
} {
  const { plan, photos, canvas } = input;
  const warnings: string[] = [];
  const base = computeSheetLayout({
    detailLabels: plan.detailCards.map((card) => card.label),
    bottomCards: plan.bottomCards.map((card) => ({ kind: card.kind, label: card.label })),
  });

  const firstOf = (kind: SheetPhoto["kind"]) => photos.find((photo) => photo.kind === kind) ?? null;
  const photoNumbered = (number: number | null) =>
    number !== null && number >= 1 && number <= photos.length ? photos[number - 1]! : null;
  const cardAspect = (card: SheetCard) =>
    card.imageRect ? (card.imageRect.w * canvas.width) / (card.imageRect.h * canvas.height) : 1;

  /** The region the brain chose, or a fallback it records. */
  const region = (
    what: string,
    number: number | null,
    box: number[] | null,
    fallback: SheetPhoto | null,
    shape: { padding: number; aspect: number | null },
  ): CardSource[] => {
    let photo = photoNumbered(number);
    if (!photo) {
      photo = fallback;
      if (!photo) return [];
      warnings.push(`${what}: no such photo (${number ?? "none"}); used another photo.`);
    }
    let rect = rectFromBrainBox(box);
    if (!rect) {
      warnings.push(`${what}: the box was unusable; used the middle of the photo.`);
      rect = shape.aspect === null ? FULL_RECT : CENTRE;
    }
    rect = padRect(rect, shape.padding);
    if (shape.aspect !== null) rect = fitRectToAspect(rect, shape.aspect, photo.aspect);
    return [{ path: photo.path, box: rect }];
  };

  const viewShape = { padding: VIEW_PADDING, aspect: null };
  const cards: ComposedCard[] = base.cards.map((card): ComposedCard => {
    switch (card.role) {
      case "hero":
        return {
          ...card,
          sources: input.approved.front
            ? [{ path: input.approved.front, box: FULL_RECT }]
            : region(
                "Front",
                plan.front.photo,
                plan.front.box,
                firstOf("front") ?? photos[0] ?? null,
                viewShape,
              ),
        };
      case "back":
        if (input.approved.back) {
          return { ...card, sources: [{ path: input.approved.back, box: FULL_RECT }] };
        }
        if (!plan.back) {
          const back = firstOf("back");
          return { ...card, sources: back ? [{ path: back.path, box: FULL_RECT }] : [] };
        }
        return {
          ...card,
          sources: region("Back", plan.back.photo, plan.back.box, firstOf("back"), viewShape),
        };
      case "detail": {
        const index = Number(card.id.replace("detail-", "")) - 1;
        const detail = plan.detailCards[index];
        if (!detail) return { ...card, sources: [] };
        return {
          ...card,
          sources: region(
            `Detail "${detail.label}"`,
            detail.photo,
            detail.box,
            firstOf("detail") ?? firstOf("front") ?? photos[0] ?? null,
            { padding: DETAIL_PADDING, aspect: cardAspect(card) },
          ),
        };
      }
      case "bottom": {
        const index = Number(card.id.replace("bottom-", "")) - 1;
        const bottom = plan.bottomCards[index];
        if (!bottom) return { ...card, sources: [] };
        if (bottom.kind === "pieces") {
          return {
            ...card,
            sources: input.pieceFronts.map((path) => ({ path, box: FULL_RECT })),
          };
        }
        return {
          ...card,
          sources: region(
            `Fabric "${bottom.label}"`,
            bottom.photo,
            bottom.box,
            firstOf("detail") ?? firstOf("front") ?? photos[0] ?? null,
            { padding: DETAIL_PADDING, aspect: cardAspect(card) },
          ),
        };
      }
      default:
        return { ...card, sources: [] };
    }
  });

  return {
    layout: { version: 2, aspectRatio: "16:9", canvas: { ...canvas }, cards },
    warnings,
  };
}

/**
 * The shape an owner-drawn box takes on its card: detail and fabric cards are
 * filled edge to edge, so their boxes grow to the card's shape; the front,
 * back and set cards show the whole region, so theirs stay as drawn.
 */
export function fitSourceBox(
  card: ComposedCard,
  box: NormalizedRect,
  photoAspect: number,
  canvas: { width: number; height: number },
): NormalizedRect {
  const fills = card.role === "detail" || (card.role === "bottom" && card.cropKind === "swatch");
  if (!fills || !card.imageRect) return box;
  const aspect = (card.imageRect.w * canvas.width) / (card.imageRect.h * canvas.height);
  return fitRectToAspect(box, aspect, photoAspect);
}
