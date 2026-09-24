import type { GarmentDna } from "@/lib/domain/garment-dna";

/** A realistic two-piece set used across tests. */
export const ROBE_SET_DNA: GarmentDna = {
  schemaVersion: 1,
  productSummary: "Blush satin robe with scalloped lace trim and a matching slip dress.",
  setComposition: "Robe worn open over the slip dress",
  pieces: [
    {
      position: 1,
      pieceName: "Robe",
      category: "robe",
      silhouette: "straight kimono robe",
      lengthAndFit: "knee length, relaxed",
      frontConstruction: [
        { zone: "collar", detail: "shawl collar faced with scalloped lace, 6 cm wide" },
        { zone: "waist", detail: "self-fabric belt through 2 side loops" },
        { zone: "hem", detail: "scalloped lace band 8 cm" },
      ],
      backConstruction: [
        { zone: "yoke", detail: "plain back, no seam" },
        { zone: "hem", detail: "scalloped lace band 8 cm" },
      ],
      fabrics: [
        { name: "stretch satin", finish: "high sheen", opacity: "opaque", location: "body" },
        {
          name: "Chantilly-style lace",
          finish: "matte",
          opacity: "sheer",
          location: "collar and hem",
        },
      ],
      motif: {
        type: "lace",
        description: "open roses with eyelash scallop edge",
        scale: "roses ~3 cm",
        placement: "collar and hem bands",
      },
      hardware: [{ item: "pearl button", count: 5, finish: "ivory", location: "cuffs" }],
      colors: [{ name: "Blush", hexRange: ["#E8C4C0", "#DDB3AE"], location: "body" }],
      chestPanel: null,
      keyDetails: [
        {
          label: "Scalloped lace hem",
          description: "Eyelash scallops along the hem",
          zone: "hem",
          importance: "critical",
          sellingPoint: true,
        },
        {
          label: "Satin sheen",
          description: "Liquid highlights on the body",
          zone: "body",
          importance: "high",
          sellingPoint: true,
        },
        {
          label: "Side loops",
          description: "Belt loops",
          zone: "waist",
          importance: "medium",
          sellingPoint: false,
        },
      ],
      doNotAlter: ["Keep exactly 5 pearl buttons", "Keep the lace scallop scale"],
    },
    {
      position: 2,
      pieceName: "Slip dress",
      category: "slip dress",
      silhouette: "bias-cut slip",
      lengthAndFit: "midi",
      frontConstruction: [
        { zone: "neckline", detail: "V neckline edged with lace" },
        { zone: "chest panel", detail: "lace panel, unlined" },
      ],
      backConstruction: [{ zone: "straps", detail: "adjustable straps crossing at the back" }],
      fabrics: [
        { name: "stretch satin", finish: "high sheen", opacity: "opaque", location: "body" },
      ],
      motif: { type: "none", description: "", scale: "", placement: "" },
      hardware: [{ item: "strap slider", count: 2, finish: "gold", location: "straps" }],
      colors: [{ name: "Blush", hexRange: ["#E8C4C0"], location: "body" }],
      chestPanel: {
        structure: "unstructured",
        lined: false,
        padded: false,
        projection: "zero",
        notes: "",
      },
      keyDetails: [
        {
          label: "Lace V neckline",
          description: "Lace edging on the V",
          zone: "neckline",
          importance: "critical",
          sellingPoint: true,
        },
      ],
      doNotAlter: ["Keep the crossed back straps"],
    },
  ],
  globalDoNotAlter: ["Blush colour must match the photos"],
  photoGaps: [],
};
