import "server-only";

import { colourwayBrief } from "@/lib/colorways/words";
import { approvedDna } from "@/lib/dna/service";
import type { GarmentDna } from "@/lib/domain/garment-dna";
import type { FidelityReview } from "@/lib/domain/fidelity";
import { bottomsLabelOf, slotLabelOf, type GenerationPurpose } from "@/lib/domain/generation";
import { AppError } from "@/lib/errors";
import { getGeneration } from "@/lib/generations/queries";
import { toLlmImage } from "@/lib/images/process";
import { pieceNoun } from "@/lib/prompts/house-style";
import { getDirectorBrain } from "@/lib/providers/llm";
import { getOwnerSettings } from "@/lib/settings/service";
import { storageImageHost } from "@/lib/storage/brain-links";
import { downloadForBrain } from "@/lib/storage/derivatives";
import type { GenerationRow, Json } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

const CONTEXT: Record<GenerationPurpose, string> = {
  ghost_front:
    "Ghost-mannequin FRONT view for the Shopify catalogue (garment on an invisible display form).",
  ghost_back: "Ghost-mannequin BACK view for the Shopify catalogue.",
  macro: "Advertising close-up of one garment detail for the catalogue.",
  colorway: "Colourway re-render of the approved front image — only the colour should differ.",
  product_sheet: "Product sheet board with front, back and six macro detail cards.",
  shot_preview: "First frame of a video ad shot.",
  shot_video: "Video ad shot (reviewing its first frame).",
  other: "Generated product image.",
};

/**
 * What an image is checked against. A robe set's second front (slot
 * "front_inner") shows the garment without its robe on purpose, so the robe's
 * absence is never an issue, while any trace of it is. A pyjama set's front
 * and back compose the bottoms from their flat photo, so the flat pose is
 * never an issue, while bottoms left out, shown flat or changed in fit are.
 */
export function fidelityContext(
  generation: Pick<GenerationRow, "purpose" | "slot" | "params">,
): string {
  const context =
    generation.purpose === "ghost_front" && generation.slot === "front_inner"
      ? innerFrontContext(generation.params)
      : CONTEXT[generation.purpose];
  const bottomsName = bottomsLabelOf(generation.params);
  if (!bottomsName || (generation.purpose !== "ghost_front" && generation.purpose !== "ghost_back"))
    return context;
  const bottoms = pieceNoun(bottomsName) || "bottoms";
  return `${context} This is a pyjama set photographed in parts: the top on the display form, and the ${bottoms} (the "${bottomsName}") lying flat on their own in one of the reference photos. The result must show the COMPLETE set worn together, the ${bottoms} beneath the top as they hang when worn. Compare the ${bottoms} with their flat photo for fit (wide or narrow), leg width, length, colour, waistband, hem, pockets and trims, and ignore the flat pose itself. The ${bottoms} left out, shown lying flat, folded or on their own, or changed in length, width or fit is a major issue.`;
}

function innerFrontContext(params: GenerationRow["params"]): string {
  const name = slotLabelOf(params) ?? "outer layer";
  const outer = pieceNoun(name) || "outer layer";
  return `Ghost-mannequin FRONT view of the inner garment ONLY, without its outer layer (the "${name}"), for the Shopify catalogue. The ${outer} is left out on purpose: its absence is never an issue, and any part of it in the result is a major issue. Compare the inner garment with the reference photos; where a reference shows the ${outer} worn over it, judge only the garment beneath.`;
}

/**
 * What a colourway is checked against: the requested colour in plain words,
 * so a result that kept the original colour is reported rather than passed.
 */
export function colourwayContext(colorway: { name: string; hex: string }, dna: GarmentDna): string {
  const main = dna.pieces
    .flatMap((piece) => piece.colors)
    .find((colour) => colour.name.trim() && colour.hexRange.length > 0);
  const brief = colourwayBrief(colorway, main ? { name: main.name, hex: main.hexRange[0]! } : null);
  return [
    CONTEXT.colorway,
    `The requested colour is ${brief.words} (${brief.hex}).`,
    brief.change,
    `Report a major "colour" issue when the garment is not clearly this colour, for example when it kept the original ${brief.original ?? "colour"} or drifted to another hue.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Ask the director brain to compare a finished image with its references. */
export async function reviewGenerationFidelity(
  supabase: TypedSupabaseClient,
  ownerId: string,
  generationId: string,
): Promise<FidelityReview> {
  const generation = await getGeneration(supabase, generationId);
  if (generation.status !== "completed" || !generation.storage_path) {
    throw new AppError("validation", "Wait for the result before checking fidelity.");
  }
  if (!generation.mime_type?.startsWith("image/")) {
    throw new AppError("validation", "Fidelity checks run on still images.");
  }
  if (!generation.product_id)
    throw new AppError("validation", "This result is not linked to a product.");
  const [settings, dna] = await Promise.all([
    getOwnerSettings(supabase, ownerId),
    approvedDna(supabase, generation.product_id),
  ]);
  if (!dna) throw new AppError("validation", "Approve the Garment DNA first.");
  if (generation.reference_paths.length === 0) {
    throw new AppError("validation", "There is no original photo to compare with.");
  }

  const originals = await Promise.all(
    generation.reference_paths
      .slice(0, 3)
      .map(async (path, index) =>
        toLlmImage(await downloadForBrain(supabase, path), `Original reference ${index + 1}`),
      ),
  );
  const result = await toLlmImage(
    await downloadForBrain(supabase, generation.storage_path),
    "Generated result",
  );
  const colorway =
    generation.purpose === "colorway" && generation.colorway_id
      ? (
          await supabase
            .from("colorways")
            .select("name, hex")
            .eq("id", generation.colorway_id)
            .maybeSingle()
        ).data
      : null;
  const brain = getDirectorBrain(settings, { imageHost: storageImageHost(supabase, ownerId) });
  const review = await brain.reviewFidelity({
    dna: dna.dna,
    context: colorway ? colourwayContext(colorway, dna.dna) : fidelityContext(generation),
    originals,
    result,
  });
  await supabase
    .from("generations")
    .update({
      review: {
        ...review,
        reviewer: `${brain.provider}:${brain.model}`,
        at: new Date().toISOString(),
      } as unknown as Json,
    })
    .eq("id", generationId);
  return review;
}
