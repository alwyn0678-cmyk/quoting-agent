/**
 * Container equipment as ISO 6346 size/type codes, with the colloquial names customers actually
 * write ("40HC", "40' high cube", "20ft"). TEU and class are facts about the code; the 45' TEU value
 * is an ASSUMPTION (often counted as 2.25 by carriers — ASSUMPTIONS.md H10).
 */

export type EquipmentKind = "dry" | "high_cube" | "reefer" | "open_top" | "flat_rack" | "tank";

export const EQUIPMENT = {
  "22G1": { label: "20' standard", teu: 1, kind: "dry" },
  "42G1": { label: "40' standard", teu: 2, kind: "dry" },
  "45G1": { label: "40' high cube", teu: 2, kind: "high_cube" },
  L5G1: { label: "45' high cube", teu: 2, kind: "high_cube" },
  "22R1": { label: "20' reefer", teu: 1, kind: "reefer" },
  "45R1": { label: "40' high cube reefer", teu: 2, kind: "reefer" },
  "22U1": { label: "20' open top", teu: 1, kind: "open_top" },
  "42U1": { label: "40' open top", teu: 2, kind: "open_top" },
  "22P1": { label: "20' flat rack", teu: 1, kind: "flat_rack" },
  "42P1": { label: "40' flat rack", teu: 2, kind: "flat_rack" },
  "22T1": { label: "20' tank", teu: 1, kind: "tank" },
} as const satisfies Record<string, { label: string; teu: number; kind: EquipmentKind }>;

export type IsoType = keyof typeof EQUIPMENT;

export const isIsoType = (s: unknown): s is IsoType =>
  typeof s === "string" && Object.prototype.hasOwnProperty.call(EQUIPMENT, s);

const ALIASES: Record<string, IsoType> = {
  "20": "22G1", "20GP": "22G1", "20DC": "22G1", "20DV": "22G1", "20FT": "22G1", "20STD": "22G1", "20ST": "22G1",
  "40": "42G1", "40GP": "42G1", "40DC": "42G1", "40DV": "42G1", "40FT": "42G1", "40STD": "42G1", "40ST": "42G1",
  "40HC": "45G1", "40HQ": "45G1", "40HIGHCUBE": "45G1", "40FTHC": "45G1", "40FTHIGHCUBE": "45G1",
  "45HC": "L5G1", "45": "L5G1", "45FT": "L5G1", "45HQ": "L5G1",
  "20RF": "22R1", "20RE": "22R1", "20REEFER": "22R1",
  "40RF": "45R1", "40RH": "45R1", "40REHC": "45R1", "40HR": "45R1", "40REEFER": "45R1",
  "20OT": "22U1", "40OT": "42U1", "20FR": "22P1", "40FR": "42P1", "20TK": "22T1", "20TANK": "22T1",
};

/** Customer text → ISO 6346 code, or null when the text does not name a specific equipment type. */
export function normalizeEquipment(raw: string): IsoType | null {
  const compact = raw.toUpperCase().replace(/[\s'"’`\-_.]/g, "").replace(/FEET|FOOT/g, "FT");
  if (isIsoType(compact)) return compact;
  return ALIASES[compact] ?? null;
}

export function teuOf(iso: IsoType): number {
  return EQUIPMENT[iso].teu;
}
