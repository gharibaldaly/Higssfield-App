/**
 * Colour words for colourway prompts. Image models follow plain colour words
 * far better than hex codes, and the owner's label for a colour ("cashmir",
 * "B2") may mean nothing to them, or read as a fabric. So a swatch hex becomes
 * words from its OKLCH lightness, chroma and hue (bands calibrated on common
 * fashion colours), and the change from the garment's original colour is put
 * into words too. Pure: no I/O.
 */

export type Oklch = { l: number; c: number; h: number };

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** OKLCH of a #RRGGBB colour (Björn Ottosson's OKLab); hue in degrees. */
export function oklch(hex: string): Oklch {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  const r = linear((value >> 16) & 255);
  const g = linear((value >> 8) & 255);
  const b = linear(value & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const hue = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return { l: lightness, c: Math.hypot(a, bb), h: hue };
}

/** Below this chroma a colour reads as a pure grey; below TINTED as a tinted grey. */
const NEUTRAL = 0.012;
const TINTED = 0.03;
/** Chroma bands of the colour names: muted below 0.07, soft below 0.13, then vivid. */
const MUTED = 0.07;
const SOFT = 0.13;

type Family =
  | "pink"
  | "red"
  | "copper"
  | "orange"
  | "yellow"
  | "olive"
  | "green"
  | "teal"
  | "blue"
  | "purple"
  | "mauve";

/** Upper hue bound (degrees) of each family; pink wraps around 0. */
const HUES: [number, Family][] = [
  [15, "pink"],
  [33, "red"],
  [50, "copper"],
  [75, "orange"],
  [100, "yellow"],
  [125, "olive"],
  [170, "green"],
  [215, "teal"],
  [275, "blue"],
  [320, "purple"],
  [345, "mauve"],
  [360, "pink"],
];

function familyOf(hue: number): Family {
  return (HUES.find(([limit]) => hue < limit) ?? HUES[0]!)[1];
}

/** Names from light to dark: [lowest lightness, muted, soft, vivid]. */
type Band = [number, string, string, string];

const NAMES: Record<Family, Band[]> = {
  pink: [
    [0.8, "pale blush pink", "light pink", "light pink"],
    [0.62, "dusty rose", "rose pink", "hot pink"],
    [0.45, "muted rose", "berry pink", "magenta pink"],
    [0.3, "plum", "plum", "berry"],
    [0, "dark plum", "dark plum", "dark berry"],
  ],
  red: [
    [0.8, "blush", "blush", "light coral"],
    [0.62, "dusty rose", "soft coral pink", "salmon coral"],
    [0.45, "rosy brown", "brick red", "red"],
    [0, "dark rosewood", "wine red", "wine red"],
  ],
  copper: [
    [0.85, "light beige", "peach pink", "light coral"],
    [0.7, "nude beige", "soft coral", "coral"],
    [0.55, "taupe brown", "terracotta", "terracotta"],
    [0.4, "brown", "copper brown", "rust"],
    [0, "dark chocolate brown", "dark chocolate brown", "dark rust"],
  ],
  orange: [
    [0.85, "light beige", "peach", "light orange"],
    [0.7, "nude beige", "camel", "orange"],
    [0.55, "taupe brown", "caramel brown", "burnt orange"],
    [0.4, "brown", "chestnut brown", "burnt orange"],
    [0, "dark chocolate brown", "dark chocolate brown", "dark chocolate brown"],
  ],
  yellow: [
    [0.88, "cream", "pale butter yellow", "bright yellow"],
    [0.7, "khaki beige", "sand gold", "mustard yellow"],
    [0.5, "olive khaki", "ochre", "ochre"],
    [0, "dark olive brown", "dark olive brown", "dark olive brown"],
  ],
  olive: [
    [0.8, "pale sage", "pale lime", "pale lime"],
    [0.55, "light olive", "light olive", "lime green"],
    [0, "olive green", "olive green", "olive green"],
  ],
  green: [
    [0.8, "pale mint", "mint", "mint"],
    [0.62, "sage green", "fresh green", "bright green"],
    [0.45, "muted green", "green", "green"],
    [0, "dark forest green", "emerald green", "emerald green"],
  ],
  teal: [
    [0.78, "pale aqua", "aqua", "turquoise"],
    [0.5, "dusty teal", "teal", "teal"],
    [0, "dark teal", "dark teal", "dark teal"],
  ],
  blue: [
    [0.78, "powder blue", "sky blue", "sky blue"],
    [0.55, "slate blue", "cornflower blue", "royal blue"],
    [0.4, "steel blue", "denim blue", "cobalt blue"],
    [0, "navy blue", "navy blue", "navy blue"],
  ],
  purple: [
    [0.75, "lavender", "lavender", "light violet"],
    [0.55, "dusty lilac", "soft purple", "violet"],
    [0.4, "muted purple", "purple", "purple"],
    [0, "deep aubergine", "deep aubergine", "deep purple"],
  ],
  mauve: [
    [0.75, "lilac", "lilac", "orchid pink"],
    [0.55, "dusty mauve", "mauve", "fuchsia"],
    [0.4, "plum mauve", "plum", "magenta"],
    [0, "dark plum", "dark plum", "dark magenta"],
  ],
};

/** The tint word of a tinted grey ("mauve-grey"), by family. */
const TINT: Record<Family, string> = {
  pink: "rose",
  red: "rose",
  copper: "warm",
  orange: "warm",
  yellow: "warm",
  olive: "olive",
  green: "sage",
  teal: "blue",
  blue: "blue",
  purple: "lavender",
  mauve: "mauve",
};

/** A very light tinted neutral, by family. */
const PALE: Record<Family, string> = {
  pink: "pale blush",
  red: "pale blush",
  copper: "champagne",
  orange: "champagne",
  yellow: "ivory",
  olive: "ivory",
  green: "pale sage",
  teal: "pale icy grey",
  blue: "pale icy grey",
  purple: "pale lavender",
  mauve: "pale blush",
};

/** Noun of a family, for "pink instead of mauve". */
const NOUN: Record<Family, string> = {
  pink: "pink",
  red: "red",
  copper: "warm brown",
  orange: "warm brown",
  yellow: "yellow-beige",
  olive: "olive",
  green: "green",
  teal: "teal",
  blue: "blue",
  purple: "purple",
  mauve: "mauve",
};

function greyLightness(l: number): string {
  return l < 0.55 ? "dark" : l < 0.72 ? "medium" : "light";
}

function neutralName({ l }: Oklch): string {
  if (l < 0.28) return "black";
  if (l < 0.4) return "neutral charcoal grey";
  if (l < 0.88) return `neutral ${greyLightness(l)} grey`;
  return l < 0.97 ? "off-white" : "white";
}

function tintedName({ l, h }: Oklch): string {
  const family = familyOf(h);
  if (l < 0.28) return "black";
  if (l >= 0.88) return PALE[family];
  const tint = TINT[family];
  const grey = tint === "warm" ? "greige" : `${tint}-grey`;
  return l < 0.4 ? `very dark ${grey}` : `${greyLightness(l)} ${grey}`;
}

/** Plain words for a hex colour: "dusty rose", "navy blue", "neutral medium grey". */
export function describeHex(hex: string): string {
  const colour = oklch(hex);
  if (colour.c < NEUTRAL) return neutralName(colour);
  if (colour.c < TINTED) return tintedName(colour);
  const family = familyOf(colour.h);
  if (family === "blue" && colour.l < 0.4 && colour.h < 235) return "dark petrol blue";
  const band = NAMES[family].find(([lowest]) => colour.l >= lowest) ?? NAMES[family].at(-1)!;
  return colour.c < MUTED ? band[1] : colour.c < SOFT ? band[2] : band[3];
}

/** Colour groups for checking an owner's colour name against the swatch. */
type Group = "neutral" | "warm" | "pink" | "green" | "blue" | "purple";

const GROUP: Record<Family, Group> = {
  pink: "pink",
  red: "pink",
  copper: "warm",
  orange: "warm",
  yellow: "warm",
  olive: "green",
  green: "green",
  teal: "blue",
  blue: "blue",
  purple: "purple",
  mauve: "purple",
};

function groupOf(hex: string): Group {
  const colour = oklch(hex);
  return colour.c < TINTED ? "neutral" : GROUP[familyOf(colour.h)];
}

type NamedColour = {
  words: string;
  groups: Group[];
  /** OKLab lightness a swatch of this colour can have; outside it the label wins. */
  lightness?: [number, number];
  absolute?: boolean;
};

/**
 * Colour words an owner may use, in English and Arabic (Egyptian shop names
 * included). English keys match whole words; Arabic keys also match with a
 * prefix such as the article ("الأسود").
 */
const NAMED: [string[], NamedColour][] = [
  [["black", "اسود", "سودا"], { words: "black", groups: ["neutral"], absolute: true }],
  [["white", "ابيض", "بيضا"], { words: "white", groups: ["neutral"], absolute: true }],
  [
    ["off white", "offwhite", "اوف وايت"],
    { words: "off-white", groups: ["neutral", "warm"], lightness: [0.85, 1] },
  ],
  [["ivory", "عاجي"], { words: "ivory", groups: ["neutral", "warm"], lightness: [0.85, 1] }],
  [["cream", "كريم", "سكري"], { words: "cream", groups: ["neutral", "warm"], lightness: [0.8, 1] }],
  [["grey", "gray", "رمادي", "رصاصي"], { words: "grey", groups: ["neutral"] }],
  [["silver", "فضي"], { words: "silver grey", groups: ["neutral"] }],
  [
    ["charcoal", "anthracite", "فحمي"],
    { words: "charcoal grey", groups: ["neutral"], lightness: [0, 0.5] },
  ],
  [["taupe"], { words: "taupe", groups: ["neutral", "warm", "purple"] }],
  [["beige", "بيج"], { words: "beige", groups: ["warm", "neutral"], lightness: [0.7, 1] }],
  [["nude", "نود", "نيود"], { words: "nude beige", groups: ["warm", "pink"] }],
  [
    ["champagne", "شامبين", "شمبانيا"],
    { words: "champagne", groups: ["warm", "neutral"], lightness: [0.8, 1] },
  ],
  [["camel", "جملي"], { words: "camel", groups: ["warm"] }],
  [["caramel", "كراميل"], { words: "caramel brown", groups: ["warm"] }],
  [["brown", "بني"], { words: "brown", groups: ["warm"] }],
  [["mocha", "coffee", "موكا", "كافيه", "قهوه"], { words: "coffee brown", groups: ["warm"] }],
  [
    ["chocolate", "شوكولا", "شيكولا"],
    { words: "chocolate brown", groups: ["warm"], lightness: [0, 0.5] },
  ],
  [["orange", "برتقالي"], { words: "orange", groups: ["warm"] }],
  [["peach", "apricot", "خوخي", "مشمشي"], { words: "peach", groups: ["warm", "pink"] }],
  [["coral", "كورال"], { words: "coral", groups: ["warm", "pink"] }],
  [["rust", "terracotta", "طوبي", "قرميدي"], { words: "terracotta", groups: ["warm"] }],
  [["yellow", "اصفر"], { words: "yellow", groups: ["warm"] }],
  [["mustard", "مسترده", "خردلي"], { words: "mustard yellow", groups: ["warm", "green"] }],
  [["gold", "golden", "ذهبي"], { words: "gold", groups: ["warm"] }],
  [["khaki", "كاكي"], { words: "khaki", groups: ["warm", "green", "neutral"] }],
  [["olive", "زيتي"], { words: "olive green", groups: ["green", "warm"] }],
  [["green", "اخضر"], { words: "green", groups: ["green"] }],
  [["sage"], { words: "sage green", groups: ["green", "neutral"] }],
  [["mint", "منت", "نعناعي"], { words: "mint", groups: ["green", "blue"], lightness: [0.7, 1] }],
  [["emerald", "زمردي"], { words: "emerald green", groups: ["green"] }],
  [["teal", "petrol", "بترولي"], { words: "petrol teal", groups: ["blue", "green"] }],
  [
    ["turquoise", "aqua", "tiffany", "تركواز", "فيروزي"],
    { words: "turquoise", groups: ["blue", "green"] },
  ],
  [["navy", "كحلي"], { words: "navy blue", groups: ["blue"], lightness: [0, 0.5] }],
  [["blue", "ازرق", "لبني"], { words: "blue", groups: ["blue"] }],
  [["denim", "jeans", "جينز"], { words: "denim blue", groups: ["blue"] }],
  [["lavender", "لافندر"], { words: "lavender", groups: ["purple"], lightness: [0.65, 1] }],
  [["lilac", "ليلكي", "ليلك"], { words: "lilac", groups: ["purple", "pink"] }],
  [["mauve", "موف"], { words: "mauve", groups: ["purple", "pink"] }],
  [["purple", "violet", "بنفسجي"], { words: "purple", groups: ["purple"] }],
  [["plum", "aubergine", "برقوقي", "باذنجاني"], { words: "plum", groups: ["purple", "pink"] }],
  [["fuchsia", "fushia", "فوشيا", "فوشي"], { words: "fuchsia", groups: ["pink", "purple"] }],
  [["pink", "وردي", "بمبي", "بينك"], { words: "pink", groups: ["pink"] }],
  [["rose", "روز"], { words: "rose pink", groups: ["pink"] }],
  [["blush", "بلاش"], { words: "blush pink", groups: ["pink", "warm"], lightness: [0.7, 1] }],
  [["salmon", "سيمون", "سالمون"], { words: "salmon pink", groups: ["pink", "warm"] }],
  [["red", "احمر"], { words: "red", groups: ["pink"] }],
  [
    ["wine", "نبيتي", "خمري"],
    { words: "wine red", groups: ["pink", "purple"], lightness: [0, 0.5] },
  ],
  [
    ["burgundy", "بورجوندي", "بورجندي"],
    { words: "burgundy", groups: ["pink", "purple"], lightness: [0, 0.5] },
  ],
  [["maroon", "مارون"], { words: "maroon", groups: ["pink", "warm"], lightness: [0, 0.5] }],
];

/** Lower case, Arabic letter forms unified (أ إ آ → ا, ة → ه, ى → ي), marks removed. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[_\-./]+/g, " ");
}

/** Every key, longest first, so "off white" is read before "white". */
const KEYS = NAMED.flatMap(([keys, named]) => keys.map((key) => [key, named] as const)).sort(
  ([a], [b]) => b.length - a.length,
);

/** Where a key appears in a folded label, or -1. */
function position(folded: string, key: string): number {
  if (/[\u0600-\u06ff]/.test(key)) return folded.indexOf(key);
  return new RegExp(`(?<![a-z])${key}(?![a-z])`).exec(folded)?.index ?? -1;
}

/** The colour named in an owner's label, if it names one it knows. */
export function namedColour(label: string): NamedColour | null {
  let folded = fold(label);
  const found: { at: number; named: NamedColour }[] = [];
  for (const [key, named] of KEYS) {
    const at = position(folded, key);
    if (at === -1) continue;
    // A longer key already read this part of the label ("off white" before "white").
    folded = folded.slice(0, at) + " ".repeat(key.length) + folded.slice(at + key.length);
    if (!found.some((entry) => entry.named === named)) found.push({ at, named });
  }
  if (found.length === 0) return null;
  if (found.length === 1) return found[0]!.named;
  const inOrder = found.sort((a, b) => a.at - b.at).map((entry) => entry.named);
  return {
    words: inOrder.map((named) => named.words).join(" "),
    groups: [...new Set(inOrder.flatMap((named) => named.groups))],
  };
}

/**
 * The words for a colourway. A label that names a colour the swatch agrees
 * with (group and lightness) gets the swatch's more exact words ("blue" →
 * "navy blue"); black and white stay as named; a label the swatch contradicts
 * is trusted, since phone light skews a swatch; any other label ("cashmir")
 * is described from the hex.
 * `fromHex` says whether the hue of the words came from the swatch.
 */
export function colourWords(label: string, hex: string): { words: string; fromHex: boolean } {
  const named = namedColour(label);
  if (!named) return { words: describeHex(hex), fromHex: true };
  const [lowest, highest] = named.lightness ?? [0, 1];
  const { l } = oklch(hex);
  const agrees = named.groups.includes(groupOf(hex)) && l >= lowest && l <= highest;
  return named.absolute || !agrees
    ? { words: named.words, fromHex: false }
    : { words: describeHex(hex), fromHex: true };
}

/**
 * How a colour differs from the original, in words: "lighter, pink instead of
 * mauve". Hue is left out when it only came from the owner's label.
 */
export function describeColourChange(
  fromHex: string,
  toHex: string,
  withHue = true,
): string | null {
  const from = oklch(fromHex);
  const to = oklch(toHex);
  const parts: string[] = [];
  const lighter = to.l - from.l;
  if (lighter > 0.15) parts.push("much lighter");
  else if (lighter > 0.04) parts.push("lighter");
  else if (lighter < -0.15) parts.push("much darker");
  else if (lighter < -0.04) parts.push("darker");

  if (withHue) {
    const fromFamily = familyOf(from.h);
    const toFamily = familyOf(to.h);
    if (to.c < NEUTRAL && from.c >= NEUTRAL) {
      parts.push(`neutral, with none of its ${TINT[fromFamily]} tint`);
    } else if (to.c >= NEUTRAL && from.c < NEUTRAL) {
      parts.push(`clearly ${NOUN[toFamily]} instead of neutral grey`);
    } else if (to.c >= NEUTRAL && NOUN[toFamily] !== NOUN[fromFamily]) {
      parts.push(`${NOUN[toFamily]} instead of ${NOUN[fromFamily]}`);
    }
    const richer = to.c - from.c;
    if (to.c >= NEUTRAL && from.c >= NEUTRAL) {
      if (richer > 0.03) parts.push("more colourful");
      else if (richer < -0.03) parts.push("more muted");
    }
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

export type OriginalColour = { name: string; hex: string };

export type ColourwayBrief = {
  /** Plain colour words for the image model ("dusty rose"). */
  words: string;
  hex: string;
  /** The garment's original colour, as the DNA names it. */
  original: string | null;
  /** "Compared with the original taupe grey, it is lighter, …", or null. */
  change: string | null;
};

/** Everything a colourway prompt says about its colour. */
export function colourwayBrief(
  colorway: { name: string; hex: string },
  original: OriginalColour | null,
): ColourwayBrief {
  const { words, fromHex } = colourWords(colorway.name, colorway.hex);
  const originalName = original
    ? original.name.trim().toLowerCase() || describeHex(original.hex)
    : null;
  const difference = original ? describeColourChange(original.hex, colorway.hex, fromHex) : null;
  return {
    words,
    hex: colorway.hex.toUpperCase(),
    original: originalName,
    change:
      difference && originalName
        ? `Compared with the original ${originalName}, it is ${difference}.`
        : null,
  };
}
