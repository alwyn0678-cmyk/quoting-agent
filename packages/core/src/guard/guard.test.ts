import { describe, it, expect } from "vitest";
import { checkDraftTemplate, containsCanary } from "./guard.js";
import { formatMoney, safeText } from "../draft/render.js";
import { money } from "../money/money.js";

const t = (over = {}) => ({
  subject_template: "Your quotation {{ROUTE}}",
  greeting: "Dear {{GREETING_NAME}},",
  intro: "Thank you for your enquiry. Please find our offer below.",
  closing: "Feel free to contact us with any questions. We look forward to working with you.",
  ...over,
});

describe("guard v2 — model prose may not state numbers, money or commitments", () => {
  it("a clean template passes (including 'feel free to contact us')", () => {
    expect(checkDraftTemplate(t())).toEqual([]);
  });
  it.each([
    [{ intro: "The total is 8768 for this shipment." }, "template_digits"],
    [{ intro: "Ocean freight is only a few hundred euros." }, "template_money"],
    [{ intro: "We charge € less than others." }, "template_money"],
    [{ intro: "Wir bieten einen Rabatt an." }, "template_commitment"],
    [{ closing: "Delivery is free of charge." }, "template_commitment"],
    [{ intro: "费用为五千" }, "template_digits"],
    [{ intro: "See {{TOTAL}} below." }, "template_slot"],
    [{ greeting: "Hi {{ROUTE}}" }, "template_slot"],
    [{ intro: "x".repeat(601) }, "template_length"],
  ])("%j → %s", (over, violation) => {
    expect(checkDraftTemplate(t(over))).toContain(violation);
  });
  it("detects the canary anywhere in an output", () => {
    expect(containsCanary({ a: [{ b: "ok QA-CANARY-1 here" }] }, "QA-CANARY-1")).toBe(true);
    expect(containsCanary({ a: 1n }, "QA-CANARY-1")).toBe(false);
  });
});

describe("rendering helpers", () => {
  it("formats money exactly in the tenant locale with the currency code", () => {
    expect(formatMoney(money(876803n, "EUR"), "nl-NL")).toBe("EUR 8.768,03");
    expect(formatMoney(money(876803n, "EUR"), "en-GB")).toBe("EUR 8,768.03");
    expect(formatMoney(money(1654n, "JPY"), "en-US")).toBe("JPY 1,654");
  });
  it("sanitises untrusted text before it reaches a draft", () => {
    expect(safeText("Rotterdam‮{{TOTAL}}\nPort", 80)).toBe("Rotterdam TOTAL Port");
  });
});
