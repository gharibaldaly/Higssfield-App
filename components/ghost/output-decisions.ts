import { postJson } from "@/components/common/post-json";
import type { GenerationView } from "@/lib/domain/generation";
import type { ActionResult } from "@/lib/errors";

/** What a page gives its review decisions: the polling hook's decide/undecide and its refresh. */
export type OutputDecisions = {
  decide: (view: GenerationView, reviewStatus: GenerationView["reviewStatus"]) => void;
  undecide: (view: GenerationView) => void;
  refresh: () => void;
};

/**
 * Approves a catalogue output: on screen at once, on the server in the
 * background. A failure puts the tile back; either way one refresh brings
 * the job and batch states up to date (a burst of approvals shares it).
 */
export async function approveOutput(
  view: GenerationView,
  { decide, undecide, refresh }: OutputDecisions,
): Promise<ActionResult> {
  decide(view, "approved");
  const result = await postJson<undefined>("/api/catalogue/approve", { generationId: view.id });
  if (!result.ok) undecide(view);
  refresh();
  return result;
}

/**
 * Regenerates a catalogue output through its route, which waits while the
 * director brain writes the new prompt. Meanwhile the tile shows the output
 * as rejected (the server marks it so first), which reads as "regenerating";
 * the refresh then brings the new image in.
 */
export async function regenerateOutput(
  view: GenerationView,
  note: string | null,
  { decide, undecide, refresh }: OutputDecisions,
): Promise<ActionResult<{ generationId: string }>> {
  decide(view, "rejected");
  const result = await postJson<{ generationId: string }>("/api/catalogue/regenerate", {
    generationId: view.id,
    note,
  });
  if (!result.ok) undecide(view);
  refresh();
  return result;
}
