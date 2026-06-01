const LABELS: Record<string, { cls: string; text: string }> = {
  received: { cls: "recv", text: "Received" },
  processing: { cls: "proc", text: "Processing" },
  awaiting_review: { cls: "await", text: "Awaiting" },
  sending: { cls: "send", text: "Sending" },
  escalated: { cls: "esc", text: "Escalated" },
  sent: { cls: "sent", text: "Sent" },
  error: { cls: "err", text: "Error" },
};

export function StatusBadge({ status }: { status: string }) {
  const m = LABELS[status] ?? { cls: "recv", text: status.replace(/_/g, " ") };
  return <span className={`chip ${m.cls}`}>{m.text}</span>;
}
