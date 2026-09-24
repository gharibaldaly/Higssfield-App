import "server-only";

import { approvedDna } from "@/lib/dna/service";
import type { FidelityReview } from "@/lib/domain/fidelity";
import type { GenerationPurpose } from "@/lib/domain/generation";
import { AppError } from "@/lib/errors";
import { getGeneration } from "@/lib/generations/queries";
import { toLlmImage } from "@/lib/images/process";
import { getDirectorBrain } from "@/lib/providers/llm";
import { getOwnerSettings } from "@/lib/settings/service";
import { downloadObject } from "@/lib/storage/objects";
import type { Json } from "@/lib/supabase/database.types";
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
        toLlmImage(await downloadObject(supabase, path), `Original reference ${index + 1}`),
      ),
  );
  const result = await toLlmImage(
    await downloadObject(supabase, generation.storage_path),
    "Generated result",
  );
  const brain = getDirectorBrain({
    provider: settings.llmProvider,
    claudeModel: settings.claudeModel,
    geminiModel: settings.geminiModel,
  });
  const review = await brain.reviewFidelity({
    dna: dna.dna,
    context: CONTEXT[generation.purpose],
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
