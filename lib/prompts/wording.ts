/**
 * Neutral technical wording. Image/video providers run content filters, and
 * anatomical or suggestive words get sleepwear prompts rejected. Every prompt
 * that leaves the app passes through neutralizeWording().
 */

type Replacement = [pattern: RegExp, replacement: string];

const REPLACEMENTS: Replacement[] = [
  [/\bghost[-\s]?mannequins?\b/gi, "invisible display form"],
  [/\b(?:dress\s+)?mannequins?\b/gi, "invisible display form"],
  [/\bdress\s*forms?\b/gi, "invisible display form"],
  [/\bbust\s*(?:area|line|panel)?s?\b/gi, "chest panel"],
  [/\bbreasts?\b/gi, "chest panel"],
  [/\bcleavage\b/gi, "neckline"],
  [/\bnipples?\b/gi, "chest panel"],
  [/\bbra\s*cups?\b/gi, "chest panel"],
  [/\bcups?\b(?=\s+(?:shape|shaping|projection|area|size))/gi, "chest panel"],
  [/\bunderwire[ds]?\b/gi, "shaping channel"],
  [/\bcrotch\b/gi, "gusset"],
  [/\bbutt(?:ocks)?\b/gi, "back panel"],
  [/\bbody\s*shape\b/gi, "garment shape"],
  [/\blingerie\b/gi, "sleepwear set"],
  [/\bnegligee\b/gi, "sleepwear gown"],
  [/\bbabydoll\b/gi, "short sleepwear gown"],
  [/\bundergarments?\b/gi, "loungewear"],
  [/\bunderwear\b/gi, "loungewear"],
  [/\bpanties\b/gi, "sleepwear shorts"],
  [/\bthongs?\b/gi, "sleepwear bottom"],
  [/\bbras\b/gi, "bralette tops"],
  [/\bbra\b/gi, "bralette top"],
  [/\b(?:sexy|sensual|seductive|erotic|provocative)\b/gi, "elegant"],
  // "nude" is a common colour name in sleepwear; keep the colour meaning.
  [/\bnude\b/gi, "warm beige"],
  [/\bnaked\b/gi, "bare"],
];

export function neutralizeWording(text: string): string {
  let result = text;
  for (const [pattern, replacement] of REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  // Collapse accidental doubles like "invisible display form invisible display form".
  return result
    .replace(/\b(invisible display form)(?:\s+\1)+\b/gi, "$1")
    .replace(/[ \t]{2,}/g, " ");
}

/** Words that must never reach a provider prompt (used by tests and guards). */
export const FORBIDDEN_PROMPT_WORDS = [
  "mannequin",
  "breast",
  "cleavage",
  "nipple",
  "lingerie",
  "sexy",
  "nude",
  "naked",
] as const;

export function findForbiddenWords(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN_PROMPT_WORDS.filter((word) => lower.includes(word));
}
