import { PORT_LABELS } from "./ports.js";

/**
 * Deterministic cross-check of the model's UN/LOCODE against the place text it came from. The model
 * maps "Rotterdam" → NLRTM; code verifies the mapping wherever it can, so a wrong but well-formed code
 * ("Antwerp" → NLRTM) is caught instead of silently pricing the wrong lane. The index covers the
 * canonical labels plus common local-language names; a place it does not know is left to the model
 * (unrecognised), never rejected.
 */

/** Local-language and common alternative names → UN/LOCODE (canonical English labels are added below). */
const ALIASES: Readonly<Record<string, string>> = {
  "roterdã": "NLRTM", "roterdao": "NLRTM", "roterdam": "NLRTM", "rotterdamm": "NLRTM", "鹿特丹": "NLRTM",
  "antwerpen": "BEANR", "anvers": "BEANR", "amberes": "BEANR", "antuerpia": "BEANR", "安特卫普": "BEANR",
  "hamburgo": "DEHAM", "hambourg": "DEHAM", "汉堡": "DEHAM",
  "nueva york": "USNYC", "nova york": "USNYC", "nova iorque": "USNYC", "nyc": "USNYC", "纽约": "USNYC",
  "los angeles": "USLAX", "洛杉矶": "USLAX",
  "上海": "CNSHA", "宁波": "CNNGB", "深圳": "CNSZX", "青岛": "CNTAO", "厦门": "CNXMN", "天津": "CNTSN",
  "新加坡": "SGSIN", "cingapura": "SGSIN", "singapur": "SGSIN",
  "xangai": "CNSHA", "shanghái": "CNSHA", "schanghai": "CNSHA",
  "duisburgo": "DEDUI", "le havre": "FRLEH", "durbã": "ZADUR", "santos": "BRSSZ",
};

const fold = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const INDEX: ReadonlyMap<string, string> = new Map([
  ...Object.entries(PORT_LABELS).map(([code, name]) => [fold(name), code] as const),
  ...Object.entries(ALIASES).map(([name, code]) => [fold(name), code] as const),
]);

const hasCjk = (s: string) => /\p{Script=Han}/u.test(s);

/** Known UN/LOCODEs named in a place text (word-bounded for alphabetic names, substring for Han). */
export function namedPorts(raw: string): string[] {
  const text = ` ${fold(raw)} `;
  const found = new Set<string>();
  for (const [name, code] of INDEX) {
    if (hasCjk(name) ? text.includes(name) : text.includes(` ${name} `)) found.add(code);
  }
  for (const m of raw.toUpperCase().matchAll(/\b[A-Z]{2}[A-Z2-9]{3}\b/g)) if (PORT_LABELS[m[0]]) found.add(m[0]);
  return [...found].sort();
}

export type PlaceCheck = "consistent" | "contradicts" | "unrecognised";

export function checkPlace(raw: string, unlocode: string): PlaceCheck {
  const named = namedPorts(raw);
  if (named.length === 0 || !PORT_LABELS[unlocode]) return "unrecognised";
  return named.includes(unlocode) ? "consistent" : "contradicts";
}
