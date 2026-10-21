import { describe, it, expect } from "vitest";
import { containsCanary } from "./guard.js";
import { formatMoney } from "../draft/render.js";
import { money } from "../money/money.js";

describe("guard v2", () => {
  it("detects the canary anywhere in an output (incl. inside bigint-bearing structures)", () => {
    expect(containsCanary({ a: [{ b: "ok QA-CANARY-1 here" }] }, "QA-CANARY-1")).toBe(true);
    expect(containsCanary({ a: 1n }, "QA-CANARY-1")).toBe(false);
  });
});

describe("money formatting", () => {
  it("formats exactly in the tenant locale with the currency code", () => {
    expect(formatMoney(money(876803n, "EUR"), "nl-NL")).toBe("EUR 8.768,03");
    expect(formatMoney(money(876803n, "EUR"), "en-GB")).toBe("EUR 8,768.03");
    expect(formatMoney(money(1654n, "JPY"), "en-US")).toBe("JPY 1,654");
  });
});
