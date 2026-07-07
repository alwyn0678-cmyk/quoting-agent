import { GraphFetchTransport, missingEnv } from "./graph-transport.js";

/**
 * Outlook SEND (D-27 — deliberately reverses D-14/R1's "no send"). Used ONLY by the trusted
 * send-outbox worker (scripts/send_outbox.ts, service_role + Graph) after a human Approve has claimed
 * a request to 'sending'. The browser dashboard never imports this and holds no Graph creds.
 */

/** A mailer the sender needs — GraphFetchTransport satisfies it; a fake satisfies it in tests. */
export interface MailSender {
  sendMail(userId: string, sendMailBody: unknown): Promise<void>;
}

/**
 * Extract the canonical address from an EmailInput.from. The poll builds "Name <addr>" with the REAL
 * address as the LAST <...> group (outlook.ts toInbound), and the display NAME is attacker-controlled
 * — so we take the LAST bracketed group, never the first. A spoofed name like 'x <evil@a.com>' cannot
 * redirect the reply (codex Gate-4 P2). Returns null if no valid address is present.
 */
export function parseEmailAddress(from: string): string | null {
  const last = [...from.matchAll(/<([^>]+)>/g)].at(-1);
  const candidate = (last?.[1] ?? from).trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(candidate) ? candidate : null;
}

/** Pure: the Graph /sendMail request body for a plain-text reply. saveToSentItems keeps a Sent copy. */
export function buildSendMailBody(to: string, subject: string, body: string) {
  return {
    message: {
      subject,
      body: { contentType: "Text", content: body },
      toRecipients: [{ emailAddress: { address: to } }],
    },
    saveToSentItems: true,
  };
}

/** Sends quote-reply mail from a fixed mailbox over an injected MailSender. */
export class OutlookSender {
  constructor(
    private readonly mailer: MailSender,
    private readonly userId: string,
  ) {}

  async sendReply(to: string, subject: string, body: string): Promise<void> {
    await this.mailer.sendMail(this.userId, buildSendMailBody(to, subject, body));
  }
}

/** Env the send worker needs (no GRAPH_QUOTE_FOLDER — sending is folder-agnostic). The single source
 *  of truth for hasGraphSendEnv AND the factory below, so list and check cannot desync. */
const SEND_ENV_KEYS = [
  "GRAPH_TENANT_ID",
  "GRAPH_CLIENT_ID",
  "GRAPH_CLIENT_SECRET",
  "GRAPH_MAILBOX_USER",
] as const;

/** True only when every var the send worker needs is set. */
export function hasGraphSendEnv(): boolean {
  return missingEnv(SEND_ENV_KEYS).length === 0;
}

/** Build the live sender from env (the send-outbox worker uses this). Throws NAMING the missing keys
 *  if any var is absent — the check is derived from SEND_ENV_KEYS, never a hand-maintained copy. */
export function createOutlookSenderFromEnv(): OutlookSender {
  const missing = missingEnv(SEND_ENV_KEYS);
  if (missing.length > 0) {
    throw new Error(`${missing.join(" / ")} required for the send worker`);
  }
  // Safe cast: missingEnv just proved every key is set and non-empty.
  const env = process.env as Record<(typeof SEND_ENV_KEYS)[number], string>;
  return new OutlookSender(
    new GraphFetchTransport({
      tenantId: env.GRAPH_TENANT_ID,
      clientId: env.GRAPH_CLIENT_ID,
      clientSecret: env.GRAPH_CLIENT_SECRET,
    }),
    env.GRAPH_MAILBOX_USER,
  );
}
