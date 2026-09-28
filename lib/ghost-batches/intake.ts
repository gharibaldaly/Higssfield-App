/**
 * Groups a drop of photos into garment models and guesses each photo's role,
 * before anything is uploaded. Pure (shared by the browser and the tests).
 *
 * Grouping, best signal first:
 * 1. folders: one sub-folder per model ("DS-1024/front.jpg"); role folders
 *    inside a model ("DS-1024/colours/red.jpg") tag their photos, and a folder
 *    holding only role folders is one model;
 * 2. file names, when they clearly name several models: "DS1024_front.jpg",
 *    "DS1024-back-2.jpg" share the model "DS1024";
 * 3. otherwise the whole drop is one model (camera names such as IMG_2231.jpg
 *    say nothing about the model); the owner can split it in order, N photos
 *    per model.
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

/**
 * How photos that only their order can group are split: "all" keeps the
 * whole drop as one model, a number starts a new model every N photos.
 */
export type PhotosPerModel = number | "all";

export const MAX_MODELS_PER_BATCH = 100;
export const MAX_GARMENT_PHOTOS_PER_MODEL = 16;
export const MAX_COLOUR_PHOTOS_PER_MODEL = 8;
export const DEFAULT_PHOTOS_PER_MODEL: PhotosPerModel = "all";

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

/**
 * Lower case, Arabic letter variants folded, diacritics dropped, and a
 * trailing number dropped from a word ("back2" → "back"). A number after one
 * or two letters stays, since that is a model code: "B20124" is not "b" (back).
 */
export function normalizeToken(token: string): string {
  const folded = token
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
  const word = folded.replace(/\d+$/, "");
  return word.length >= 3 ? word : folded;
}

const KEYWORD_TAG = new Map<string, IntakeTag>(
  INTAKE_TAGS.flatMap((tag) => KEYWORDS[tag].map((word) => [normalizeToken(word), tag] as const)),
);

/** Image extensions, repeated ones included ("IMG_5124.JPG.jpg", "IMG_5124.HEIC.jpeg"). */
const IMAGE_EXTENSIONS = /(?:\.(?:jpe?g|png|webp|heic|heif|avif|gif|tiff?|bmp|dng))+$/i;

export function stemOf(name: string): string {
  const stem = name.replace(IMAGE_EXTENSIONS, "");
  return stem !== name ? stem : name.replace(/\.[^./\\]+$/, "");
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

/**
 * Names that cameras, phones, chat apps and image tools make up: IMG_2231,
 * IMG_E2231 (edited on an iPhone), PXL_…, 20260927_101010, WhatsApp images,
 * screenshots, ChatGPT and Gemini images. They say nothing about the model.
 */
const CAMERA_NAME =
  /^(?:img|dsc|dscn|dscf|pxl|mvimg|photo|image|picture|snapchat|signal|download|untitled)[\s_-]*e?[\d_\-\s.()]*$|^(?:whatsapp image|screenshot|screen shot|chatgpt image|gemini[_ ]generated[_ ]image)(?![a-z])|^[\d_\-\s.()]+$|^\d{8}[_-]\d{6}/i;

/** Copy and edit marks a computer adds to a camera name ("IMG_2231 - Copy (2)", "IMG_2231.MP"). */
const COPY_MARKS = /(?:[\s_-]*(?:copy|edited|نسخة|نسخه|\(\d+\)|\.mp))+$/i;

export function isCameraName(name: string): boolean {
  return CAMERA_NAME.test(stemOf(name).trim().replace(COPY_MARKS, ""));
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

function groupBySequence(
  files: IntakeFileInfo[],
  perModel: PhotosPerModel,
  startAt: number,
): Draft[] {
  const sorted = [...files].sort((a, b) => naturalCompare(a.path, b.path));
  const size =
    perModel === "all"
      ? Math.max(1, sorted.length)
      : Math.max(1, Math.min(MAX_GARMENT_PHOTOS_PER_MODEL, Math.round(perModel)));
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

/**
 * Splits a drop by model names only when the names clearly name several
 * models; otherwise the drop is one model. A name counts as a model when it
 * has a digit (a code such as "DS1024") or two photos share it; a lone word
 * ("lace.jpg") describes a photo of the same garment.
 */
function groupByNames(
  files: IntakeFileInfo[],
  perModel: PhotosPerModel,
): { drafts: Draft[]; grouping: IntakeGrouping } {
  const named = files
    .map((file) => ({ file, tokens: modelTokensOfName(file.name) }))
    .filter((entry) => entry.tokens.length > 0);
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
  const models = [...byKey.values()]
    .filter((draft) => draft.files.length >= 2 || /\d/.test(draft.key))
    .sort((a, b) => naturalCompare(a.name, b.name));
  const grouped = new Set(models.flatMap((draft) => draft.files.map(({ file }) => file.id)));
  if (models.length >= 2 && grouped.size >= files.length / 2) {
    const rest = files.filter((file) => !grouped.has(file.id));
    return {
      drafts: [...models, ...groupBySequence(rest, perModel, models.length + 1)],
      grouping: "names",
    };
  }
  const drafts = groupBySequence(files, perModel, 1);
  if (models.length === 1 && drafts.length === 1 && grouped.size >= files.length / 2) {
    // One model name on most of the photos names the whole drop.
    return {
      drafts: [{ ...drafts[0]!, key: models[0]!.key, name: models[0]!.name }],
      grouping: "names",
    };
  }
  return { drafts, grouping: "sequence" };
}

/** The role named by the first role folder in a path ("DS-1024/تفاصيل/…" → detail). */
function roleOfFolders(folders: string[]): IntakeTag | null {
  return folders.map((folder) => tagFromText(folder)).find((tag) => tag !== null) ?? null;
}

/**
 * A folder that only says which view its photos show ("أمام", "Back", "colours"),
 * never a model: no digits and more than one letter, so "B1" stays a model.
 */
function isRoleFolder(name: string): boolean {
  return tagFromText(name) !== null && !/\d/.test(name) && normalizeToken(name).length > 1;
}

/**
 * Plans the models for one drop of photo files (already filtered to accepted
 * image types). `perModel` only matters when photos can only be grouped in order.
 */
export function planIntake(
  files: IntakeFileInfo[],
  options: { perModel?: PhotosPerModel } = {},
): { models: IntakeModelPlan[]; grouping: IntakeGrouping } {
  const perModel = options.perModel ?? DEFAULT_PHOTOS_PER_MODEL;
  if (files.length === 0) return { models: [], grouping: "names" };
  const parts = files.map((file) => file.path.split(/[\\/]+/).filter(Boolean));
  const root = commonFolder(parts);
  const inFolders = parts.some((segments) => segments.length - root >= 2);
  // The folders every photo sits in, nearest first: role folders ("أمام")
  // tag the photos, and the nearest other folder names the model.
  const above = parts[0]!.slice(0, root).reverse();
  const nameIndex = above.findIndex((folder) => !isRoleFolder(folder));
  const nameFolder = nameIndex >= 0 ? above[nameIndex] : undefined;
  const aboveRole = roleOfFolders(above.slice(0, nameIndex >= 0 ? nameIndex : above.length));
  if (!inFolders) {
    const { drafts, grouping } = groupByNames(files, perModel);
    // One folder holding one model's photos: the folder names the model.
    if (drafts.length === 1 && grouping === "sequence" && (nameFolder || aboveRole)) {
      const draft = drafts[0]!;
      drafts[0] = {
        key: nameFolder ? `folder-${nameFolder}` : draft.key,
        name: nameFolder ?? draft.name,
        files: draft.files.map(({ file }) => ({ file, roleTag: aboveRole })),
      };
      return { models: finish(drafts), grouping: "folders" };
    }
    return { models: finish(drafts), grouping };
  }

  // Only role folders below the common folder ("DS-1024/أمام", "DS-1024/خلف"): one model.
  if (parts.every((segments) => segments.length - root < 2 || isRoleFolder(segments[root]!))) {
    const draft: Draft = {
      key: nameFolder ? `folder-${nameFolder}` : "sequence-1",
      name: nameFolder ?? "#1",
      files: files.map((file, index) => ({
        file,
        roleTag: roleOfFolders(parts[index]!.slice(root, -1)) ?? aboveRole,
      })),
    };
    return { models: finish([draft]), grouping: "folders" };
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
    const roleTag = roleOfFolders(segments.slice(1, -1));
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
