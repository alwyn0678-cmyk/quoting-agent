/**
 * Exact decimal arithmetic: value = coef × 10^-scale, with a bigint coefficient. Addition,
 * subtraction and multiplication are exact (multiplication adds scales). The ONLY place precision is
 * lost is an explicit rounding — `round` or `divRound` — and every call names its mode. There is no
 * default mode, because an implicit default (truncation in dinero.js, BigInt `/`) is how pricing
 * engines silently lose cents.
 *
 * Mode names are deliberately unambiguous ("half-up" means away-from-zero in Python but towards +∞ in
 * dinero.js — a real source of credit-note mismatches):
 *   HALF_AWAY_FROM_ZERO  2.345 → 2.35, -2.345 → -2.35   (commercial rounding; the pricing default)
 *   HALF_EVEN            2.345 → 2.34, 2.355 → 2.36       (banker's rounding)
 *   CEILING / FLOOR      towards +∞ / towards −∞          (e.g. chargeable quantities round up)
 */

export type RoundingMode = "HALF_AWAY_FROM_ZERO" | "HALF_EVEN" | "CEILING" | "FLOOR";

const DEC_RE = /^-?\d+(\.\d+)?$/;
/** Inputs longer than this are rejected before parsing (resource bound; well beyond any real rate). */
const MAX_INPUT_LENGTH = 40;

const pow10 = (n: number): bigint => 10n ** BigInt(n);

/** Integer division n / d with a single explicit rounding. */
export function roundDiv(n: bigint, d: bigint, mode: RoundingMode): bigint {
  if (d === 0n) throw new Error("division by zero");
  const negative = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  let q = an / ad;
  const r = an % ad;
  if (r !== 0n) {
    switch (mode) {
      case "HALF_AWAY_FROM_ZERO":
        if (2n * r >= ad) q += 1n;
        break;
      case "HALF_EVEN":
        if (2n * r > ad || (2n * r === ad && q % 2n === 1n)) q += 1n;
        break;
      case "CEILING":
        if (!negative) q += 1n;
        break;
      case "FLOOR":
        if (negative) q += 1n;
        break;
    }
  }
  return negative ? -q : q;
}

export class Dec {
  private constructor(
    readonly coef: bigint,
    readonly scale: number,
  ) {}

  static parse(s: string): Dec {
    if (typeof s !== "string" || s.length > MAX_INPUT_LENGTH || !DEC_RE.test(s)) {
      throw new Error(`invalid decimal '${String(s).slice(0, MAX_INPUT_LENGTH)}'`);
    }
    const negative = s.startsWith("-");
    const body = negative ? s.slice(1) : s;
    const [int, frac = ""] = body.split(".");
    const coef = BigInt(`${int}${frac}`);
    return new Dec(negative ? -coef : coef, frac.length);
  }

  static of(coef: bigint, scale = 0): Dec {
    if (!Number.isInteger(scale) || scale < 0) throw new Error(`invalid scale ${scale}`);
    return new Dec(coef, scale);
  }

  static fromInt(n: number | bigint): Dec {
    if (typeof n === "number" && !Number.isSafeInteger(n)) throw new Error(`not a safe integer: ${n}`);
    return new Dec(BigInt(n), 0);
  }

  static readonly ZERO = new Dec(0n, 0);
  static readonly ONE = new Dec(1n, 0);

  /** Exact rational a / b rounded once to `scale` decimal places. */
  static divRound(a: Dec, b: Dec, scale: number, mode: RoundingMode): Dec {
    if (b.coef === 0n) throw new Error("division by zero");
    // a.coef·10^-a.s / (b.coef·10^-b.s) = q·10^-scale  ⇒  q = a.coef·10^(scale + b.s) / (b.coef·10^a.s)
    const n = a.coef * pow10(scale + b.scale);
    const d = b.coef * pow10(a.scale);
    return new Dec(roundDiv(n, d, mode), scale);
  }

  private rescaled(scale: number): bigint {
    if (scale < this.scale) throw new Error("internal: rescale would lose precision");
    return this.coef * pow10(scale - this.scale);
  }

  add(o: Dec): Dec {
    const s = Math.max(this.scale, o.scale);
    return new Dec(this.rescaled(s) + o.rescaled(s), s);
  }

  sub(o: Dec): Dec {
    return this.add(o.neg());
  }

  mul(o: Dec): Dec {
    return new Dec(this.coef * o.coef, this.scale + o.scale);
  }

  neg(): Dec {
    return new Dec(-this.coef, this.scale);
  }

  cmp(o: Dec): -1 | 0 | 1 {
    const s = Math.max(this.scale, o.scale);
    const a = this.rescaled(s);
    const b = o.rescaled(s);
    return a < b ? -1 : a > b ? 1 : 0;
  }

  isZero(): boolean {
    return this.coef === 0n;
  }

  isNegative(): boolean {
    return this.coef < 0n;
  }

  max(o: Dec): Dec {
    return this.cmp(o) >= 0 ? this : o;
  }

  min(o: Dec): Dec {
    return this.cmp(o) <= 0 ? this : o;
  }

  /** Round to `scale` decimal places with an explicit mode (exact when scale ≥ current scale). */
  round(scale: number, mode: RoundingMode): Dec {
    if (scale >= this.scale) return new Dec(this.rescaled(scale), scale);
    return new Dec(roundDiv(this.coef, pow10(this.scale - scale), mode), scale);
  }

  /** The coefficient at exactly `scale` places; throws if that would lose precision. */
  coefAt(scale: number): bigint {
    const r = this.round(scale, "FLOOR");
    if (r.cmp(this) !== 0) throw new Error(`precision: ${this.toString()} has more than ${scale} decimal places`);
    return r.coef;
  }

  /** Canonical string: no exponent, no trailing fractional zeros, no "-0". */
  toString(): string {
    if (this.coef === 0n) return "0";
    const negative = this.coef < 0n;
    let digits = (negative ? -this.coef : this.coef).toString();
    let scale = this.scale;
    while (scale > 0 && digits.endsWith("0")) {
      digits = digits.slice(0, -1);
      scale -= 1;
    }
    if (scale > 0) {
      digits = digits.padStart(scale + 1, "0");
      digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
    }
    return negative ? `-${digits}` : digits;
  }

  /** Fixed-scale string (e.g. money display) — exact; throws rather than round silently. */
  toFixedString(scale: number): string {
    const coef = this.coefAt(scale);
    const negative = coef < 0n;
    let digits = (negative ? -coef : coef).toString();
    if (scale > 0) {
      digits = digits.padStart(scale + 1, "0");
      digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
    }
    return negative ? `-${digits}` : digits;
  }
}
