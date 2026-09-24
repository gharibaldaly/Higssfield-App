import { describe, expect, it } from "vitest";

import { CONTROL_OPTIONS } from "@/lib/domain/director";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") result.set(path, value);
    else for (const [nested, text] of flatten(value, path)) result.set(nested, text);
  }
  return result;
}

const EN = flatten(en as Tree);
const AR = flatten(ar as Tree);

/** Argument names in an ICU message, including those inside plural/select branches. */
function placeholders(message: string): string[] {
  const names = new Set<string>();
  let index = 0;

  const readUntil = (stops: string) => {
    const start = index;
    while (index < message.length && !stops.includes(message[index]!)) index += 1;
    return message.slice(start, index).trim();
  };

  function parseText(insideBranch: boolean) {
    while (index < message.length) {
      const char = message[index]!;
      if (char === "}" && insideBranch) return;
      index += 1;
      if (char === "{") parseArgument();
    }
  }

  function parseArgument() {
    names.add(readUntil(",}"));
    if (message[index++] === "}") return;
    const type = readUntil(",}");
    if (message[index++] === "}") return;
    if (type === "plural" || type === "select" || type === "selectordinal") {
      while (index < message.length) {
        readUntil("{}");
        if (message[index++] === "}") return;
        parseText(true);
        index += 1;
      }
    }
    readUntil("}");
    index += 1;
  }

  parseText(false);
  return [...names].sort();
}

describe("messages", () => {
  it("has the same keys in English and Arabic", () => {
    const missingInArabic = [...EN.keys()].filter((key) => !AR.has(key));
    const missingInEnglish = [...AR.keys()].filter((key) => !EN.has(key));
    expect(missingInArabic).toEqual([]);
    expect(missingInEnglish).toEqual([]);
  });

  it("uses the same ICU placeholders in both languages", () => {
    expect(
      placeholders("{count, plural, one {# of {total}} other {{total} left}} for {name}"),
    ).toEqual(["count", "name", "total"]);
    const mismatched = [...EN.entries()]
      .filter(([key, text]) => placeholders(text).join() !== placeholders(AR.get(key) ?? "").join())
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  it("has no empty strings", () => {
    const empty = [...EN.entries(), ...AR.entries()]
      .filter(([, text]) => text.trim() === "")
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it("labels every director option in both languages", () => {
    for (const [control, options] of Object.entries(CONTROL_OPTIONS)) {
      for (const option of options) {
        const key = `director.options.${control}.${option.id}`;
        expect(EN.has(key), `en ${key}`).toBe(true);
        expect(AR.has(key), `ar ${key}`).toBe(true);
      }
    }
  });
});
