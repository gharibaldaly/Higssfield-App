/**
 * Groups a drop of photos into garment models and guesses each photo's role,
 * before anything is uploaded. Pure (shared by the browser and the tests).
 *
 * Grouping, best signal first:
 * 1. folders: one sub-folder per model ("DS-1024/front.jpg"); role folders
 *    inside a model ("DS-1024/colours/red.jpg") tag their photos;
 * 2. file names: "DS1024_front.jpg", "DS1024-back-2.jpg" share the model "DS1024";
 * 3. sequence: camera names (IMG_2231.jpg) are split in order, N photos per model.
 * Roles come from keywords (English and Arabic); untagged photos default to
 * front, then back, then details, and the director brain re-sorts them later.
 */

export const INTAKE_TAGS = ["front", "back", "detail", "colour"] as const;
export type IntakeTag = (typeof INTAKE_TAGS)[number];

/** Where a tag came from: a keyword, the photo order (re-sorted by the brain) or the owner. */
export type TagSource = "name" | "order" | "manual";

export type IntakeFileInfo = {
  id: string;
  name: string;
  /** Relative path including folders, e.g. "Batch/DS-1024/front.jpg"; just the name when flat. */
  path: string;
};

export type IntakePhotoPlan = {
  fileId: string;
  tag: IntakeTag;
  tagSource: TagSource;
  /** Colour name read from a colour photo's file name, when there is one. */
  colourName: string | null;
};

export type IntakeModelPlan = {
  key: string;
  name: string;
  photos: IntakePhotoPlan[];
};

export type IntakeGrouping = "folders" | "names" | "sequence";

export const MAX_MODELS_PER_BATCH = 100;
export const MAX_GARMENT_PHOTOS_PER_MODEL = 16;
export const MAX_COLOUR_PHOTOS_PER_MODEL = 8;
export const DEFAULT_PHOTOS_PER_MODEL = 3;

const KEYWORDS: Record<IntakeTag, string[]> = {
  front: ["front", "frontal", "fr", "f", "امام", "الامام", "قدام", "فرونت", "وش"],
  back: ["back", "rear", "bk", "b", "خلف", "الخلف", "ظهر", "الظهر", "ضهر", "باك"],
  detail: [
    "detail",
    "details",
    "close",
    "closeup",
    "zoom",
    "macro",
    "d",
    "تفاصيل",
    "تفصيله",
    "كلوز",
    "زوم",
    "زووم",
    "ماكرو",
    "قريب",
  ],
  colour: [
    "colour",
    "color",
    "colours",
    "colors",
    "swatch",
    "swatches",
    "fabric",
    "لون",
    "الوان",
    "الالوان",
    "قماش",
  ],
};

/** Lower case, Arabic letter variants folded, diacritics and trailing digits dropped. */
export function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\d+$/, "");
}

const KEYWORD_TAG = new Map<string, IntakeTag>(
  INTAKE_TAGS.flatMap((tag) => KEYWORDS[tag].map((word) => [normalizeToken(word), tag] as const)),
);

export function stemOf(name: string): string {
  return name.replace(/\.[^./\\]+$/, "");
}

export function tokensOf(text: string): string[] {
  return text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** The role a keyword token names, if any. */
export function tagOfToken(token: string): IntakeTag | null {
  const normalized = normalizeToken(token);
  return normalized ? (KEYWORD_TAG.get(normalized) ?? null) : null;
}

function tagFromText(text: string): IntakeTag | null {
  // Colour wins over views ("back colour red" is a swatch), details over front/back.
  const tags = tokensOf(text)
    .map(tagOfToken)
    .filter((tag): tag is IntakeTag => tag !== null);
  for (const tag of ["colour", "detail", "front", "back"] as const) {
    if (tags.includes(tag)) return tag;
  }
  return null;
}

const CAMERA_NAME =
  /^(?:img|dsc|dscn|dscf|pxl|mvimg|photo|image|snapchat|signal)[\s_-]*[\d_\-\s.()]*$|^(?:whatsapp image|screenshot|screen shot)\b|^[\d_\-\s.()]+$|^\d{8}[_-]\d{6}/i;

export function isCameraName(name: string): boolean {
  return CAMERA_NAME.test(stemOf(name).trim());
}

/**
 * The words of a file name that name the model: everything before the first
 * role keyword ("DS1024 لون كحلي" → DS1024), without a trailing short index.
 */
export function modelTokensOfName(name: string): string[] {
  if (isCameraName(name)) return [];
  const tokens = tokensOf(stemOf(name));
  const firstRole = tokens.findIndex((token) => tagOfToken(token) !== null);
  let model =
    firstRole > 0
      ? tokens.slice(0, firstRole)
      : tokens.filter((token) => tagOfToken(token) === null);
  if (model.length > 1 && /^\d{1,2}$/.test(model[model.length - 1]!)) model = model.slice(0, -1);
  return model;
}

export function modelKeyOfName(name: string): string | null {
  const tokens = modelTokensOfName(name);
  return tokens.length > 0 ? tokens.join("-").toLowerCase() : null;
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function commonFolder(paths: string[][]): number {
  if (paths.length === 0) return 0;
  let depth = 0;
  for (;;) {
    const segment = paths[0]![depth];
    if (
      segment === undefined ||
      paths.some((parts) => parts.length - 1 <= depth || parts[depth] !== segment)
    ) {
      return depth;
    }
    depth += 1;
  }
}

function colourNameOf(name: string, modelTokens: Set<string>): string | null {
  const words = tokensOf(stemOf(name)).filter((token) => {
    if (tagOfToken(token) !== null) return false;
    if (modelTokens.has(token.toLowerCase())) return false;
    return !/^\d{1,2}$/.test(token);
  });
  const text = words.join(" ").trim();
  return text ? text.slice(0, 120) : null;
}

type Draft = {
  key: string;
  name: string;
  files: { file: IntakeFileInfo; roleTag: IntakeTag | null }[];
};

/** Default tags: keywords first, then front → back → details in name order. */
export function tagPhotos(
  files: { file: IntakeFileInfo; roleTag: IntakeTag | null }[],
  modelName: string,
): IntakePhotoPlan[] {
  const modelTokens = new Set(tokensOf(modelName).map((token) => token.toLowerCase()));
  const sorted = [...files].sort((a, b) => naturalCompare(a.file.path, b.file.path));
  const plans = sorted.map(({ file, roleTag }) => {
    const tag = tagFromText(stemOf(file.name)) ?? roleTag;
    return {
      fileId: file.id,
      tag: tag ?? ("detail" as IntakeTag),
      tagSource: (tag ? "name" : "order") as TagSource,
      colourName: tag === "colour" ? colourNameOf(file.name, modelTokens) : null,
    };
  });
  let hasFront = plans.some((plan) => plan.tag === "front");
  let hasBack = plans.some((plan) => plan.tag === "back");
  for (const plan of plans) {
    if (plan.tagSource !== "order") continue;
    if (!hasFront) {
      plan.tag = "front";
      hasFront = true;
    } else if (!hasBack) {
      plan.tag = "back";
      hasBack = true;
    }
  }
  return plans;
}

function finish(drafts: Draft[]): IntakeModelPlan[] {
  return drafts
    .filter((draft) => draft.files.length > 0)
    .map((draft) => ({
      key: draft.key,
      name: draft.name.slice(0, 200),
      photos: tagPhotos(draft.files, draft.name),
    }));
}

function groupBySequence(files: IntakeFileInfo[], perModel: number, startAt: number): Draft[] {
  const size = Math.max(1, Math.min(MAX_GARMENT_PHOTOS_PER_MODEL, Math.round(perModel)));
  const sorted = [...files].sort((a, b) => naturalCompare(a.path, b.path));
  const drafts: Draft[] = [];
  for (let index = 0; index < sorted.length; index += size) {
    const number = startAt + drafts.length;
    drafts.push({
      key: `sequence-${number}`,
      name: `#${number}`,
      files: sorted.slice(index, index + size).map((file) => ({ file, roleTag: null })),
    });
  }
  return drafts;
}

function groupByNames(
  files: IntakeFileInfo[],
  perModel: number,
): { drafts: Draft[]; grouping: IntakeGrouping } {
  const keyed = files.map((file) => ({ file, tokens: modelTokensOfName(file.name) }));
  const named = keyed.filter((entry) => entry.tokens.length > 0);
  const unnamed = keyed.filter((entry) => entry.tokens.length === 0).map((entry) => entry.file);
  if (named.length < files.length / 2) {
    return { drafts: groupBySequence(files, perModel, 1), grouping: "sequence" };
  }
  // A name that extends another model's name is a descriptor of that model
  // ("DS1024 lace" belongs to "DS1024"), so the shortest matching key wins.
  const keys = [...new Set(named.map((entry) => entry.tokens.join("-").toLowerCase()))].sort(
    (a, b) => a.length - b.length,
  );
  const ownerOf = (key: string) =>
    keys.find((candidate) => key === candidate || key.startsWith(`${candidate}-`)) ?? key;
  const byKey = new Map<string, Draft>();
  for (const { file, tokens } of named) {
    const key = ownerOf(tokens.join("-").toLowerCase());
    const draft = byKey.get(key) ?? {
      key: `name-${key}`,
      name: tokens.slice(0, key.split("-").length).join(" "),
      files: [],
    };
    draft.files.push({ file, roleTag: null });
    byKey.set(key, draft);
  }
  const drafts = [...byKey.values()].sort((a, b) => naturalCompare(a.name, b.name));
  return {
    drafts: [...drafts, ...groupBySequence(unnamed, perModel, drafts.length + 1)],
    grouping: "names",
  };
}

/**
 * Plans the models for a drop of photo files (already filtered to accepted
 * image types). `perModel` only matters when photos can only be grouped in sequence.
 */
export function planIntake(
  files: IntakeFileInfo[],
  options: { perModel?: number } = {},
): { models: IntakeModelPlan[]; grouping: IntakeGrouping } {
  const perModel = options.perModel ?? DEFAULT_PHOTOS_PER_MODEL;
  if (files.length === 0) return { models: [], grouping: "names" };
  const parts = files.map((file) => file.path.split(/[\\/]+/).filter(Boolean));
  const root = commonFolder(parts);
  const inFolders = parts.some((segments) => segments.length - root >= 2);
  if (!inFolders) {
    const { drafts, grouping } = groupByNames(files, perModel);
    // One folder holding one model's photos: the folder names the model.
    const folder = root > 0 ? parts[0]![root - 1] : undefined;
    if (drafts.length === 1 && folder && grouping === "sequence") {
      drafts[0] = { ...drafts[0]!, key: `folder-${folder}`, name: folder };
      return { models: finish(drafts), grouping: "folders" };
    }
    return { models: finish(drafts), grouping };
  }

  const byFolder = new Map<string, Draft>();
  const loose: IntakeFileInfo[] = [];
  files.forEach((file, index) => {
    const segments = parts[index]!.slice(root);
    if (segments.length < 2) {
      loose.push(file);
      return;
    }
    const modelFolder = segments[0]!;
    const roleTag =
      segments
        .slice(1, -1)
        .map((folder) => tagFromText(folder))
        .find((tag) => tag !== null) ?? null;
    const draft = byFolder.get(modelFolder) ?? {
      key: `folder-${modelFolder}`,
      name: modelFolder,
      files: [],
    };
    draft.files.push({ file, roleTag });
    byFolder.set(modelFolder, draft);
  });
  const folders = [...byFolder.values()].sort((a, b) => naturalCompare(a.name, b.name));
  const extra = loose.length > 0 ? groupByNames(loose, perModel).drafts : [];
  return { models: finish([...folders, ...extra]), grouping: "folders" };
}
