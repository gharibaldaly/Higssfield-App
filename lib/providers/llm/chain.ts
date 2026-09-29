import "server-only";

import type { AdPlan } from "@/lib/domain/ad-plan";
import type { FidelityReview } from "@/lib/domain/fidelity";
import type { GarmentDna } from "@/lib/domain/garment-dna";
import type { PhotoClassification } from "@/lib/domain/photo-classification";
import type { SheetPhotoPlan } from "@/lib/domain/sheet";
import { AppError, isAppError, type AppErrorCode } from "@/lib/errors";
import type {
  AnalyzeGarmentInput,
  BuiltPrompt,
  ClassifyPhotosInput,
  DirectorBrain,
  GhostPromptInput,
  LlmProviderId,
  PlanAdInput,
  ReviewFidelityInput,
  SheetPlanInput,
  ShotPromptInput,
} from "@/lib/providers/llm/types";

/** How long a brain rests after each kind of failure before the chain asks it again. */
const REST_MS: Partial<Record<AppErrorCode, number>> = {
  provider_rate_limit: 60_000,
  provider_busy: 60_000,
  provider_credits: 60 * 60_000,
  provider_auth: 10 * 60_000,
  provider_unavailable: 2 * 60_000,
  provider_timeout: 2 * 60_000,
  not_found: 10 * 60_000, // an unknown model id at that service
  config: 10 * 60_000,
};

/** The request's own fault: no other brain would do better. */
const OWN_FAULT = new Set<AppErrorCode>(["validation", "auth"]);

export type ChainMember = {
  brain: DirectorBrain;
  /** Identifies the brain across requests, so a rest outlives one page's chain. */
  key: string;
  /** For Settings and error messages, e.g. "Mistral · mistral-small-latest". */
  label: string;
};

/** Per server instance: brains that reported a limit, a bad key or an outage. */
const resting = new Map<string, { until: number; reason: string }>();

/** Test hook. */
export function forgetRestingBrains(): void {
  resting.clear();
}

/**
 * Several brains in order of preference. A call goes to the first brain that
 * is not resting and moves to the next when a brain fails for a reason
 * another brain may not share: its limit, its key, an outage, a refusal, an
 * unreadable answer. A brain that reported a limit, a bad key or an outage
 * rests for a while, so later calls skip it without asking. `provider` and
 * `model` name the brain that answered last, for the rows that record who
 * wrote what.
 */
export class ChainBrain implements DirectorBrain {
  private current: ChainMember;

  constructor(private readonly members: ChainMember[]) {
    if (members.length === 0) throw new Error("A brain chain needs at least one brain.");
    this.current = members[0]!;
  }

  get provider(): LlmProviderId {
    return this.current.brain.provider;
  }

  get model(): string {
    return this.current.brain.model;
  }

  /** The brains in the order they are asked. */
  get order(): string[] {
    return this.members.map((member) => member.label);
  }

  classifyPhotos(input: ClassifyPhotosInput): Promise<PhotoClassification> {
    return this.run((brain) => brain.classifyPhotos(input));
  }

  analyzeGarment(input: AnalyzeGarmentInput): Promise<GarmentDna> {
    return this.run((brain) => brain.analyzeGarment(input));
  }

  planProductSheet(input: SheetPlanInput): Promise<SheetPhotoPlan> {
    return this.run((brain) => brain.planProductSheet(input));
  }

  buildGhostPrompt(input: GhostPromptInput): Promise<BuiltPrompt> {
    return this.run((brain) => brain.buildGhostPrompt(input));
  }

  planAd(input: PlanAdInput): Promise<AdPlan> {
    return this.run((brain) => brain.planAd(input));
  }

  buildShotPrompt(input: ShotPromptInput): Promise<BuiltPrompt> {
    return this.run((brain) => brain.buildShotPrompt(input));
  }

  reviewFidelity(input: ReviewFidelityInput): Promise<FidelityReview> {
    return this.run((brain) => brain.reviewFidelity(input));
  }

  private async run<T>(call: (brain: DirectorBrain) => Promise<T>): Promise<T> {
    const failures: string[] = [];
    let last: AppError | null = null;
    for (const member of this.members) {
      const rest = resting.get(member.key);
      if (rest && rest.until > Date.now()) {
        failures.push(`${member.label}: resting (${rest.reason})`);
        continue;
      }
      if (rest) resting.delete(member.key);
      try {
        const result = await call(member.brain);
        this.current = member;
        return result;
      } catch (error) {
        if (!isAppError(error) || OWN_FAULT.has(error.code)) throw error;
        // A single brain's error stands as it is.
        if (this.members.length === 1) throw error;
        const restMs = REST_MS[error.code];
        if (restMs) {
          resting.set(member.key, {
            until: Date.now() + restMs,
            reason: error.message.slice(0, 120),
          });
        }
        console.warn(`Director brain ${member.label} failed (${error.code}): ${error.message}`);
        failures.push(`${member.label}: ${error.message}`);
        last = error;
      }
    }
    throw new AppError(
      last?.code ?? "provider_unavailable",
      `No director brain could answer. ${failures.join(" · ")}`,
      { retryable: last?.retryable ?? true, status: last?.status },
    );
  }
}
