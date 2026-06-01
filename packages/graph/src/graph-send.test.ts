import { describe, it, expect } from "vitest";
import { parseEmailAddress, buildSendMailBody, OutlookSender, type MailSender } from "./graph-send.js";

describe("parseEmailAddress", () => {
  it("extracts the address from 'Name <addr>' and bare addresses", () => {
    expect(parseEmailAddress("Alwyn Van Vuuren <alwyn0678@gmail.com>")).toBe("alwyn0678@gmail.com");
    expect(parseEmailAddress("buyer@apex.example")).toBe("buyer@apex.example");
  });
  it("takes the LAST bracketed group so a spoofed display name can't redirect the reply (P2)", () => {
    // toInbound builds `${name} <${realAddr}>`; a malicious name embeds its own <...> first.
    expect(parseEmailAddress("evil <evil@attacker.com> <victim@real.com>")).toBe("victim@real.com");
  });
  it("returns null when there is no valid address", () => {
    expect(parseEmailAddress("(unknown sender)")).toBeNull();
    expect(parseEmailAddress("Name <not-an-address>")).toBeNull();
    expect(parseEmailAddress("")).toBeNull();
  });
});

describe("buildSendMailBody", () => {
  it("builds a plain-text Graph sendMail body with the recipient + Sent copy", () => {
    expect(buildSendMailBody("a@b.com", "Re: Quote", "All-in EUR 3,520.")).toEqual({
      message: {
        subject: "Re: Quote",
        body: { contentType: "Text", content: "All-in EUR 3,520." },
        toRecipients: [{ emailAddress: { address: "a@b.com" } }],
      },
      saveToSentItems: true,
    });
  });
});

describe("OutlookSender", () => {
  it("sends from the configured mailbox with the built body", async () => {
    const calls: { userId: string; body: unknown }[] = [];
    const mailer: MailSender = { sendMail: async (userId, body) => void calls.push({ userId, body }) };
    await new OutlookSender(mailer, "desk@linkport.example").sendReply("a@b.com", "Re", "Body");
    expect(calls).toEqual([
      { userId: "desk@linkport.example", body: buildSendMailBody("a@b.com", "Re", "Body") },
    ]);
  });
  it("propagates a send failure (so the worker finalizes as failed, not sent)", async () => {
    const mailer: MailSender = { sendMail: async () => { throw new Error("403 Forbidden"); } };
    await expect(new OutlookSender(mailer, "u").sendReply("a@b.com", "s", "b")).rejects.toThrow(/403/);
  });
});
