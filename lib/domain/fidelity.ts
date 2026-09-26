import { z } from "zod";

/** Output of reviewFidelity: compares a generated image against the original. */
export const fidelityReviewSchema = z.object({
  verdict: z.enum(["pass", "minor_issues", "fail"]),
  score: z.number().min(0).max(100).describe("0 = unrelated garment, 100 = identical construction"),
  issues: z.array(
    z.object({
      area: z.string().min(1),
      severity: z.enum(["critical", "major", "minor"]),
      description: z.string().min(1),
    }),
  ),
  summary: z.string().min(1),
});

export type FidelityReview = z.infer<typeof fidelityReviewSchema>;
