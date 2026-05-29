# PRD.md — QuoteAgent (production vision)

> Expands `SLICE.md` to the product level. Portfolio + learning project: success is **capability
> articulation**, not revenue or users (DECISION_LOG D-02). Architecture = Option C (ARCHITECTURE.md).

## Problem
SMB ocean freight forwarders quote FCL shipments by hand: a customer emails a request, an ops
person reads it, looks up rates in their **own Excel rate engine**, and writes a reply. It's slow,
inconsistent, and ties up skilled staff — but forwarders **trust their own Excel**, not a black-box
AI that invents prices.

## Solution / wedge
An AI **front-end over the forwarder's existing rate engine**: it reads the inbound quote email,
extracts the request, prices it **through the forwarder's own rate engine** (Excel via MS Graph —
swappable behind the `RateEngine` port), and drafts a reply **for a human to approve before send**.
The model handles language; pricing stays deterministic and owned by the forwarder. No trust gap,
no quote-accuracy liability.

## Target user
A Dutch SMB ocean freight forwarder — fictional tenant **Linkport Forwarders BV** — and specifically
its **quoting/ops desk** (the reviewer who approves drafts). Admin/config roles are later.

## Success criteria
- **Primary (project): capability articulation** — every component explainable to a senior AI
  hiring manager without hand-waving (agent design, evals, observability, security, cost, deploy,
  assumptions).
- **Product-shaped (demo narrative):** an inbound FCL RTM→NYC email becomes a **correct,
  human-approved draft** with a deterministic, itemised quote and a full audit trail — or a clean
  escalation when the agent shouldn't quote. Quote figures always match the rate engine (T10).
- **Not** measured by revenue, users, or feature count (DECISION_LOG D-02).

## Scope (v1)
One lane (**Rotterdam→New York**), **FCL ocean**; **poll** ingest (D-13); **simulated** send (D-14);
**single-tenant** with a `tenant_id` seam + RLS (D-15); **versioned** rate cards with quote snapshots
(D-16); human-in-the-loop approval (D-10); Next.js dashboard + magic-link auth; Trigger.dev-orchestrated
agent run; token/cost observability.

## Non-goals (v1)
Real outbound email; multi-mode (air/LCL/rail) or multi-lane; real customer data; autonomous send;
billing/Stripe; a tenant-management/admin UI; live MS Graph webhooks (poll instead). MS Graph Excel
Online ships behind the `RateEngine` port and is gated at the Week-6 POC (fallback = Supabase adapter).

## Constraints
Hard 8-week timeline (undone scope documented as "designed, not implemented"); EU data residency
(Supabase `eu-central-1`); **domain humility** — every rate/surcharge figure is an assumption logged
in ASSUMPTIONS.md, never stated as fact.
