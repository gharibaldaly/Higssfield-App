/**
 * A versioned prompt template. Bump `version` whenever the wording changes so
 * generations and DNA rows record which template produced them.
 */
export type PromptTemplate<Input> = {
  id: string;
  version: string;
  system: string;
  render: (input: Input) => string;
};

export function templateVersion(template: { id: string; version: string }): string {
  return `${template.id}@${template.version}`;
}

/** Compact JSON for prompts: stable key order, no whitespace noise. */
export function promptJson(value: unknown): string {
  return JSON.stringify(value, null, 1);
}
