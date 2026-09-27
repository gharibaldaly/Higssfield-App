import type { ModelOption } from "@/lib/providers/higgsfield/options";

export type ModelGroup = { family: string | null; models: ModelOption[] };

/** Models grouped by family, in order of first appearance (client-safe: no registry import). */
export function groupByFamily(models: ModelOption[]): ModelGroup[] {
  const groups = new Map<string | null, ModelOption[]>();
  for (const model of models) {
    const members = groups.get(model.family) ?? [];
    members.push(model);
    groups.set(model.family, members);
  }
  return [...groups.entries()].map(([family, members]) => ({ family, models: members }));
}
