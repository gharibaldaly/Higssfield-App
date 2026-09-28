import "server-only";

import { randomInt } from "node:crypto";

import sharp from "sharp";
import { z } from "zod";

import type { LlmImage, StructuredRequest } from "@/lib/providers/llm/types";

/**
 * A gateway can accept an image and still never show it to the model (a text
 * model behind a vision name, a proxy that drops image parts, a link it cannot
 * fetch). The brain would then write garment specs from the captions alone.
 * So before a gateway model gets garment photos, it names two colours of a
 * test image that cannot be guessed from the text.
 */

/** Colours any vision model names without hesitation. */
export const TEST_COLOURS = {
  red: [229, 57, 53],
  green: [46, 158, 68],
  blue: [30, 99, 214],
  yellow: [242, 200, 15],
  black: [17, 17, 17],
  white: [250, 250, 250],
} as const satisfies Record<string, readonly [number, number, number]>;

export type TestColour = keyof typeof TEST_COLOURS;

const COLOUR_NAMES = Object.keys(TEST_COLOURS) as TestColour[];
/** Above the smallest image some vision encoders take (DeepSeek V4.1: 295,936 px, i.e. 544²). */
const SIZE = 640;

const answerSchema = z.object({ topLeft: z.string(), bottomRight: z.string() });
export type VisionAnswer = z.infer<typeof answerSchema>;

export type VisionTest = {
  request: StructuredRequest<VisionAnswer>;
  expected: { topLeft: TestColour; bottomRight: TestColour };
};

function fill(colour: TestColour) {
  const [r, g, b] = TEST_COLOURS[colour];
  return { r, g, b };
}

/** Four squares in four different colours, drawn at random. */
export async function createVisionTest(): Promise<VisionTest> {
  const pool = [...COLOUR_NAMES];
  const draw = () => pool.splice(randomInt(pool.length), 1)[0]!;
  const [topLeft, topRight, bottomLeft, bottomRight] = [draw(), draw(), draw(), draw()];
  const half = SIZE / 2;
  const square = (colour: TestColour) => ({
    create: { width: half, height: half, channels: 3 as const, background: fill(colour) },
  });
  const png = await sharp({
    create: { width: SIZE, height: SIZE, channels: 3, background: fill(topLeft) },
  })
    .composite([
      { input: square(topRight), left: half, top: 0 },
      { input: square(bottomLeft), left: 0, top: half },
      { input: square(bottomRight), left: half, top: half },
    ])
    .png()
    .toBuffer();
  const image: LlmImage = {
    mimeType: "image/png",
    base64: png.toString("base64"),
    caption: "Test image",
  };
  return {
    expected: { topLeft, bottomRight },
    request: {
      name: "vision check",
      system: "You confirm that images reach you. Answer with JSON only.",
      user: `The test image is split into four equal squares. Name the colour of the top-left square and of the bottom-right square, each as one word from: ${COLOUR_NAMES.join(", ")}. Return {"topLeft": "…", "bottomRight": "…"}.`,
      images: [image],
      schema: answerSchema,
      // Room for models that always reason before answering (Kimi K3).
      maxTokens: 16_000,
    },
  };
}

/** True when both colours are named (case and extra words ignored). */
export function passesVisionTest(answer: VisionAnswer, expected: VisionTest["expected"]): boolean {
  const names = (text: string, colour: TestColour) =>
    text
      .toLowerCase()
      .match(/[a-z]+/g)
      ?.includes(colour) ?? false;
  return names(answer.topLeft, expected.topLeft) && names(answer.bottomRight, expected.bottomRight);
}
