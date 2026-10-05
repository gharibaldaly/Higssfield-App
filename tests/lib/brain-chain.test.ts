import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { ChainBrain, forgetRestingBrains } from "@/lib/providers/llm/chain";
import type { DirectorBrain, LlmProviderId } from "@/lib/providers/llm/types";

/** A brain that answers or fails as scripted; every method behaves the same. */
class FakeBrain implements DirectorBrain {
  calls = 0;

  constructor(
    readonly provider: LlmProviderId,
    readonly model: string,
    private readonly outcome: () => unknown,
  ) {}

  private answer(): Promise<never> {
    this.calls += 1;
    const out = this.outcome();
    return out instanceof Error ? Promise.reject(out) : Promise.resolve(out as never);
  }

  classifyPhotos() {
    return this.answer();
  }
  analyzeGarment() {
    return this.answer();
  }
  planProductSheet() {
    return this.answer();
  }
  buildGhostPrompt() {
    return this.answer();
  }
  planAd() {
    return this.answer();
  }
  buildShotPrompt() {
    return this.answer();
  }
  reviewFidelity() {
    return this.answer();
  }
  polishPrompt() {
    return this.answer();
  }
}

const PHOTOS = { photos: [] };
const input = {} as never;

function member(brain: FakeBrain) {
  return { brain, key: `${brain.provider}|${brain.model}`, label: `${brain.model}` };
}

beforeEach(() => {
  forgetRestingBrains();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ChainBrain", () => {
  it("asks the first brain and names it", async () => {
    const first = new FakeBrain("gateway", "mistral-small-latest", () => PHOTOS);
    const second = new FakeBrain("gemini", "gemini-flash-latest", () => PHOTOS);
    const chain = new ChainBrain([member(first), member(second)]);
    await expect(chain.classifyPhotos(input)).resolves.toEqual(PHOTOS);
    expect(chain.provider).toBe("gateway");
    expect(chain.model).toBe("mistral-small-latest");
    expect(chain.order).toEqual(["mistral-small-latest", "gemini-flash-latest"]);
    expect(second.calls).toBe(0);
  });

  it("moves on when a brain hits its limit, lets it rest, and asks it again later", async () => {
    const first = new FakeBrain(
      "gateway",
      "glm-4.6v-flash",
      () => new AppError("provider_rate_limit", "Z.ai: too many requests", { retryable: true }),
    );
    const second = new FakeBrain("gemini", "gemini-flash-latest", () => PHOTOS);
    const chain = new ChainBrain([member(first), member(second)]);
    await expect(chain.analyzeGarment(input)).resolves.toEqual(PHOTOS);
    expect(chain.provider).toBe("gemini");
    expect(chain.model).toBe("gemini-flash-latest");
    // Resting: the next call skips it without asking.
    await chain.analyzeGarment(input);
    expect(first.calls).toBe(1);
    expect(second.calls).toBe(2);
    // After the rest it is asked again.
    vi.setSystemTime(new Date("2026-09-28T12:01:01Z"));
    await chain.analyzeGarment(input);
    expect(first.calls).toBe(2);
  });

  it("never moves on for the request's own fault", async () => {
    const first = new FakeBrain(
      "gateway",
      "a",
      () => new AppError("validation", "Upload at least one photo."),
    );
    const second = new FakeBrain("gemini", "b", () => PHOTOS);
    const chain = new ChainBrain([member(first), member(second)]);
    await expect(chain.classifyPhotos(input)).rejects.toMatchObject({ code: "validation" });
    expect(second.calls).toBe(0);
  });

  it("says what every brain said when none could answer", async () => {
    const first = new FakeBrain(
      "gateway",
      "a",
      () => new AppError("provider_credits", "Mistral: no credits left"),
    );
    const second = new FakeBrain(
      "gemini",
      "b",
      () => new AppError("provider_unavailable", "Gemini is overloaded", { retryable: true }),
    );
    const chain = new ChainBrain([member(first), member(second)]);
    await expect(chain.planAd(input)).rejects.toMatchObject({
      code: "provider_unavailable",
      message:
        "No director brain could answer. a: Mistral: no credits left · b: Gemini is overloaded",
    });
    // Both rest now; the next call names the rests without asking either.
    await expect(chain.planAd(input)).rejects.toMatchObject({
      message: expect.stringContaining("a: resting (Mistral: no credits left)"),
    });
    expect(first.calls).toBe(1);
    expect(second.calls).toBe(1);
  });

  it("lets a single brain's error stand as it is", async () => {
    const error = new AppError("provider_rate_limit", "Slow down");
    const only = new FakeBrain("gateway", "a", () => error);
    const chain = new ChainBrain([member(only)]);
    await expect(chain.reviewFidelity(input)).rejects.toBe(error);
  });

  it("does not rest a brain for a refusal or an unreadable answer, only moves on", async () => {
    const first = new FakeBrain(
      "gateway",
      "a",
      () => new AppError("llm_output", "The model returned invalid JSON."),
    );
    const second = new FakeBrain("gemini", "b", () => PHOTOS);
    const chain = new ChainBrain([member(first), member(second)]);
    await chain.classifyPhotos(input);
    await chain.classifyPhotos(input);
    expect(first.calls).toBe(2);
  });
});
