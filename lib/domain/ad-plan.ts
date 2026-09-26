import { z } from "zod";

/** Shot list produced by the director brain (planAd). */
export const plannedShotSchema = z.object({
  purpose: z
    .string()
    .min(1)
    .describe("Why this shot exists, e.g. 'hook', 'lace detail', 'set together'"),
  detailShown: z.string().min(1).describe("The garment detail this shot shows — mandatory"),
  pieceFocus: z.string().describe("Which piece(s) are on screen"),
  framing: z.string().min(1),
  angle: z.string().min(1),
  movement: z.string().min(1),
  placement: z.string().describe("Where the product is: bed, chair, wardrobe, flat lay…"),
  durationS: z.number().min(0.5).max(30),
  referenceCropIds: z
    .array(z.string())
    .describe("IDs of the isolated reference crops to use for this shot (from the provided list)"),
  prompt: z
    .string()
    .min(1)
    .describe("Scene, camera and motion description for the video model (no product lock text)"),
});

export const adPlanSchema = z.object({
  concept: z.string().min(1),
  hook: z.string().min(1),
  environmentBible: z
    .string()
    .min(1)
    .describe(
      "Fixed description of the room, its objects and their positions, shared by all shots",
    ),
  musicCue: z.string(),
  shots: z.array(plannedShotSchema).min(1).max(12),
});

export type PlannedShot = z.infer<typeof plannedShotSchema>;
export type AdPlan = z.infer<typeof adPlanSchema>;

/** Plan metadata stored on ad_projects.plan. */
export type StoredAdPlan = Omit<AdPlan, "shots"> & {
  promptVersion: string;
  provider: string;
  model: string;
  plannedAt: string;
};

export type ShotPlanIssue = { shot: number; message: string };

/**
 * Enforces preset limits the LLM might miss: shot length cap, only known
 * reference crops, at least one reference per shot. Returns fixes + notes.
 */
export function sanitizeAdPlan(
  plan: AdPlan,
  options: { maxShotDurationS: number; knownCropIds: string[]; fallbackCropId: string | null },
): { plan: AdPlan; issues: ShotPlanIssue[] } {
  const known = new Set(options.knownCropIds);
  const issues: ShotPlanIssue[] = [];
  const shots = plan.shots.map((shot, index) => {
    let durationS = Math.round(shot.durationS * 10) / 10;
    if (durationS > options.maxShotDurationS) {
      issues.push({ shot: index + 1, message: `Shortened to ${options.maxShotDurationS}s` });
      durationS = options.maxShotDurationS;
    }
    let referenceCropIds = shot.referenceCropIds.filter((id) => known.has(id));
    if (referenceCropIds.length === 0 && options.fallbackCropId) {
      issues.push({ shot: index + 1, message: "Unknown references replaced with the hero crop" });
      referenceCropIds = [options.fallbackCropId];
    }
    return { ...shot, durationS, referenceCropIds };
  });
  return { plan: { ...plan, shots }, issues };
}

export function totalDuration(shots: { durationS: number }[]): number {
  return Math.round(shots.reduce((sum, shot) => sum + shot.durationS, 0) * 10) / 10;
}
