import { z } from "zod";

/** Output of classifyPhotos: the view of every photo of one garment model. */
export const photoClassificationSchema = z.object({
  photos: z.array(
    z.object({
      index: z.number().int().min(1).describe("1-based position of the photo as attached"),
      view: z.enum(["front", "back", "detail", "other"]),
      label: z.string().describe("What the photo shows, at most 8 words"),
      clarity: z
        .number()
        .int()
        .min(1)
        .max(5)
        .describe("5 = sharp, evenly lit, whole view, uncluttered; 1 = blurred or hidden"),
    }),
  ),
});

export type PhotoClassification = z.infer<typeof photoClassificationSchema>;
export type PhotoView = PhotoClassification["photos"][number]["view"];
