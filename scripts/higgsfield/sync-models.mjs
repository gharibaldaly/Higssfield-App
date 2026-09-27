#!/usr/bin/env node
/**
 * Refreshes lib/providers/higgsfield/docs/workflows.json from Higgsfield's
 * official model docs (docs.higgsfield.ai). It reads the image and video model
 * indexes, every model family page and every workflow page, and keeps for each
 * workflow its endpoint, titles, usage notes, complete JSON input schema and
 * output field. lib/providers/higgsfield/docs-catalog.ts turns these into the
 * studio's model specs.
 *
 *   node scripts/higgsfield/sync-models.mjs
 *
 * Needs network access to docs.higgsfield.ai (behind a proxy, Node's fetch
 * needs NODE_USE_ENV_PROXY=1).
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DOCS = "https://docs.higgsfield.ai";
const INDEXES = [
  { kind: "image", path: "/docs/models/image-generation" },
  { kind: "video", path: "/docs/models/video-generation" },
];
const OUTPUT = fileURLToPath(
  new URL("../../lib/providers/higgsfield/docs/workflows.json", import.meta.url),
);

async function page(path) {
  const url = `${DOCS}${path}.md`;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.text();
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

const unescape = (text) => text.replace(/\\([_<>*[\]{}])/g, "$1");

function familySlugs(indexText) {
  const slugs = [...indexText.matchAll(/href="\/docs\/models\/([a-z0-9-]+)"/g)].map((m) => m[1]);
  return [...new Set(slugs)];
}

function parseFamily(text) {
  const title = /^# (.+?) API$/m.exec(text)?.[1]?.trim();
  const description = /^> (?!##|Fetch|Use this)(.+)$/m.exec(text)?.[1]?.trim() ?? "";
  const workflows = [
    ...text.matchAll(
      /^\| \[([^\]]+)\]\(\/docs\/models\/[a-z0-9-]+\/([a-z0-9-]+)\) *\| `POST \/([^`]+)` *\|$/gm,
    ),
  ].map((m) => ({ title: m[1].trim(), slug: m[2], endpoint: m[3] }));
  if (!title) throw new Error("family page without a title");
  return { title, description, workflows };
}

function parseWorkflow(text) {
  const endpoint = /\*\*Endpoint:\*\* `POST https:\/\/api\.higgsfield\.ai\/([^`]+)`/.exec(
    text,
  )?.[1];
  const notesBlock = /## Usage notes\n\n([\s\S]*?)\n\n## /.exec(text)?.[1] ?? "";
  const notes = notesBlock
    .split("\n")
    .map((line) => line.replace(/^\* /, "").trim())
    .filter(Boolean)
    .map(unescape);
  const schemaBlock =
    /<Accordion title="Complete JSON schema">\s*```json[^\n]*\n([\s\S]*?)```/.exec(text)?.[1];
  if (!endpoint || !schemaBlock) throw new Error("workflow page without an endpoint or schema");
  const schema = JSON.parse(
    schemaBlock
      .split("\n")
      .map((line) => line.replace(/^ {2}/, ""))
      .join("\n"),
  );
  const outputBlock =
    /A completed response includes the following output fields:\s*```json[^\n]*\n([\s\S]*?)```/.exec(
      text,
    )?.[1];
  const outputKeys = outputBlock
    ? Object.keys(JSON.parse(outputBlock)).filter((key) => key !== "status" && key !== "request_id")
    : [];
  const output = outputKeys.includes("video")
    ? "video"
    : outputKeys.includes("images")
      ? "images"
      : null;
  return { endpoint, notes, schema, output };
}

const families = [];
for (const index of INDEXES) {
  for (const slug of familySlugs(await page(index.path))) {
    const family = parseFamily(await page(`/docs/models/${slug}`));
    const workflows = [];
    for (const listed of family.workflows) {
      const workflow = parseWorkflow(await page(`/docs/models/${slug}/${listed.slug}`));
      if (workflow.endpoint !== listed.endpoint) {
        throw new Error(
          `${slug}/${listed.slug}: endpoint ${workflow.endpoint} ≠ ${listed.endpoint}`,
        );
      }
      workflows.push({ slug: listed.slug, title: listed.title, ...workflow });
    }
    families.push({
      slug,
      kind: index.kind,
      title: family.title,
      description: family.description,
      workflows,
    });
    process.stdout.write(`${slug}: ${workflows.length} workflow(s)\n`);
  }
}

const snapshot = {
  source: `${DOCS}/docs/models`,
  fetchedAt: new Date().toISOString().slice(0, 10),
  families,
};
await writeFile(OUTPUT, `${JSON.stringify(snapshot, null, 2)}\n`);
const count = families.reduce((total, family) => total + family.workflows.length, 0);
process.stdout.write(`Wrote ${families.length} families, ${count} workflows to ${OUTPUT}\n`);
