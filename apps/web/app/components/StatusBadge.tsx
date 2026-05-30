const LABELS: Record<string, { cls: string; text: string }> = {
  awaiting_review: { cls: "await", text: "Awaiting" },
  escalated: { cls: "esc", text: "Escalated" },
  sent: { cls: "sent", text: "Sent" },
};

export function StatusBadge({ status }: { status: string }) {
  const m = LABELS[status] ?? { cls: "await", text: status.replace(/_/g, " ") };
  return <span className={`chip ${m.cls}`}>{m.text}</span>;
}
