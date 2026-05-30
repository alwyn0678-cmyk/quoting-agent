# Scoped RAG knowledge layer (Q3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ground the drafted reply prose in a curated, trusted knowledge corpus retrieved via Gemini Embedding 2 + Supabase pgvector — without ever touching the price.

**Architecture:** A pure chunker turns authored markdown into chunks; a `EmbeddingClient` port (Gemini live / deterministic mock) embeds them; retrieval runs behind a `KnowledgeRetriever` port (Supabase pgvector live / in-memory cosine for hermetic tests / empty when env-absent); on the quote path `runAgent` retrieves from a query built out of *structured* quote fields (never the raw email) and passes the chunks into the draft step. Pricing, gate, and extraction are untouched; the price is computed before retrieval and re-verified after.

**Tech Stack:** TypeScript (NodeNext, strict, `noUncheckedIndexedAccess`), Zod, vitest, Supabase pgvector, Gemini Embedding 2 (`gemini-embedding-2`, REST via `fetch`), tsx for scripts. Generation stays Anthropic.

**Spec:** [docs/superpowers/specs/2026-05-30-scoped-rag-design.md](../specs/2026-05-30-scoped-rag-design.md). All corpus content is INVENTED (ASSUMPTIONS).

---

## File Structure

| File | Responsibility | Typechecked / Tested |
|---|---|---|
| `packages/agents/src/chunk-corpus.ts` (create) | pure `chunkCorpus(md, source) → KnowledgeChunk[]` | yes / yes |
| `knowledge/{surcharges,incoterms,policy,lanes}.md` (create) | authored corpus (INVENTED) | n/a / coverage test |
| `packages/agents/src/embedding-client.ts` (create) | `EmbeddingClient` port + `MockEmbeddingClient` + `cosineRank` | yes / yes |
| `packages/agents/src/gemini-embedding-client.ts` (create) | `GeminiEmbeddingClient` (REST) + `hasGeminiEnv` | yes / yes (fake fetch) |
| `packages/agents/src/knowledge-retriever.ts` (create) | `KnowledgeRetriever` port + `buildRetrievalQuery` + `InMemory`/`Supabase`/`Empty` + factory | yes / yes |
| `packages/agents/src/config.ts` (modify) | `GEMINI_EMBEDDING_MODEL`, `EMBEDDING_DIMS`, `RAG_TOP_K` | yes |
| `packages/agents/src/draft.ts` (modify) | `DraftInput.groundingContext?` + a reference-knowledge prompt block | yes / yes |
| `packages/agents/src/agent.ts` (modify) | inject `KnowledgeRetriever` (default `EmptyRetriever`); retrieve before draft | yes / yes |
| `packages/agents/src/index.ts` (modify) | export the public RAG types/factory for the CLI | yes |
| `apps/cli/src/main.ts` (modify) | pass `createKnowledgeRetrieverFromEnv()` (env-gated) | apps/web n/a; root yes |
| `supabase/migrations/0010_knowledge_base.sql` (create) | `vector` ext + `knowledge_chunks` + RLS + `match_knowledge()` | n/a |
| `scripts/index_knowledge.ts` (create) | corpus → chunk → embed → upsert (LIVE, deferred) | no (tsx) |
| `evals/rag-retrieval.ts` (create) | live pass-band eval (deferred) | no (tsx) |
| `.env.example`, `package.json` (modify) | `GEMINI_API_KEY`; `rag:index` + `db:migrate:rag` scripts | n/a |
| `docs/ASSUMPTIONS.md` (modify) | section G (corpus, all INVENTED) + the model-id VERIFY | n/a |

**Embeddings stay out of the app/runtime bundle path concerns:** `gemini-embedding-client.ts` uses `fetch` (no SDK), and is only reached via the retriever factory + the indexer.

---

### Task 1: Pure corpus chunker

**Files:**
- Create: `packages/agents/src/chunk-corpus.ts`
- Test: `packages/agents/src/chunk-corpus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/chunk-corpus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { chunkCorpus } from "./chunk-corpus.js";

describe("Q3-AC-R1 — chunkCorpus splits markdown into discrete chunks", () => {
  it("makes one chunk per ## heading, drops the doc title + blanks", () => {
    const md = [
      "# Surcharges",
      "",
      "## BAF",
      "Bunker Adjustment Factor: fuel cost recovery, per container.",
      "",
      "## ISPS",
      "Security surcharge, per container.",
      "",
    ].join("\n");
    expect(chunkCorpus(md, "surcharges")).toEqual([
      {
        source: "surcharges",
        title: "BAF",
        content: "## BAF\nBunker Adjustment Factor: fuel cost recovery, per container.",
      },
      { source: "surcharges", title: "ISPS", content: "## ISPS\nSecurity surcharge, per container." },
    ]);
  });

  it("returns no chunks for a doc with no ## headings", () => {
    expect(chunkCorpus("# Title\n\nsome intro text\n", "x")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/agents/src/chunk-corpus.test.ts`
Expected: FAIL — "Cannot find module './chunk-corpus.js'".

- [ ] **Step 3: Write the chunker**

Create `packages/agents/src/chunk-corpus.ts`:

```ts
/** A retrievable unit of the knowledge corpus. `content` keeps its heading line. */
export interface KnowledgeChunk {
  source: string;
  title: string;
  content: string;
}

/**
 * Split authored markdown into one chunk per `## heading`. Content before the first `##` (a doc
 * `# title`, intro) is dropped. Pure — no IO. Each chunk's `content` includes its `## ` heading line.
 */
export function chunkCorpus(markdown: string, source: string): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  let title: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (title !== null) {
      const content = buf.join("\n").trim();
      if (content) chunks.push({ source, title, content });
    }
  };

  for (const line of markdown.split("\n")) {
    const m = /^##\s+(.+)$/.exec(line);
    if (m) {
      flush();
      title = (m[1] ?? "").trim();
      buf = [line];
    } else if (title !== null) {
      buf.push(line);
    }
  }
  flush();
  return chunks;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/agents/src/chunk-corpus.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/chunk-corpus.ts packages/agents/src/chunk-corpus.test.ts
git commit -m "feat(rag): pure chunkCorpus (markdown -> KnowledgeChunk[])

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Authored corpus + coverage test

**Files:**
- Create: `knowledge/surcharges.md`, `knowledge/incoterms.md`, `knowledge/policy.md`, `knowledge/lanes.md`
- Test: `packages/agents/src/corpus-coverage.test.ts`

- [ ] **Step 1: Write the failing coverage test**

Create `packages/agents/src/corpus-coverage.test.ts` (asserts every fee/surcharge CODE the rate sheets use has a glossary entry — ties the corpus to the real codes):

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chunkCorpus } from "./chunk-corpus.js";

const read = (f: string) => readFileSync(resolve(process.cwd(), "knowledge", f), "utf8");

describe("Q3 corpus coverage", () => {
  it("the surcharge glossary has an entry titled by every code used on the rate sheets", () => {
    const codes = [
      "BAF", "CAF", "THC_RTM", "THC_NYC", "THC_LAX", "THC_HAM",
      "ISPS", "PSS", "CONGESTION", "DOC", "EXPORT_CUSTOMS",
    ];
    const titles = new Set(chunkCorpus(read("surcharges.md"), "surcharges").map((c) => c.title));
    for (const code of codes) expect(titles).toContain(code);
  });

  it("each corpus file chunks into at least one entry", () => {
    for (const f of ["surcharges.md", "incoterms.md", "policy.md", "lanes.md"]) {
      expect(chunkCorpus(read(f), f).length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/agents/src/corpus-coverage.test.ts`
Expected: FAIL — knowledge files do not exist yet.

- [ ] **Step 3: Author `knowledge/surcharges.md`**

Create `knowledge/surcharges.md` (one `## CODE` entry per code; ALL INVENTED — see docs/ASSUMPTIONS.md G):

```markdown
# Linkport surcharge & fee glossary (INVENTED — see docs/ASSUMPTIONS.md G)

## BAF
BAF (Bunker Adjustment Factor) recovers fluctuations in marine fuel cost. Charged per container.

## CAF
CAF (Currency Adjustment Factor) offsets exchange-rate movement on the trade lane. Charged per container.

## THC_RTM
Terminal Handling Charge at the origin terminal in Rotterdam (loading, lift-on). Charged per container.

## THC_NYC
Terminal Handling Charge at the destination terminal in New York (discharge, lift-off). Charged per container.

## THC_LAX
Terminal Handling Charge at the destination terminal in Los Angeles. Charged per container.

## THC_HAM
Terminal Handling Charge at the origin terminal in Hamburg. Charged per container.

## ISPS
ISPS is the security surcharge mandated by the International Ship and Port Facility Security code. Charged per container.

## PSS
PSS (Peak Season Surcharge) applies during periods of high demand. Charged per container.

## CONGESTION
A congestion surcharge applied when a port is operating under sustained delay. Charged per container.

## DOC
Documentation / Bill of Lading fee covering issuance of shipping documents. Charged once per shipment.

## EXPORT_CUSTOMS
Export customs handling at origin (declaration lodging and clearance). Charged once per shipment.
```

- [ ] **Step 4: Author `knowledge/incoterms.md`**

Create `knowledge/incoterms.md`:

```markdown
# Incoterms quick reference (INVENTED summaries — see docs/ASSUMPTIONS.md G)

## FOB
FOB (Free On Board) — the seller delivers the goods on board the vessel at the origin port; from that point risk and main-carriage cost pass to the buyer. Linkport quotes port-to-port ocean freight on top.

## CIF
CIF (Cost, Insurance and Freight) — the seller pays ocean freight and minimum insurance to the destination port; risk passes at origin loading. A CIF price already includes main carriage.

## EXW
EXW (Ex Works) — the buyer takes over at the seller's premises and bears all transport, including export formalities. The widest buyer responsibility.

## DAP
DAP (Delivered At Place) — the seller delivers to a named destination ready for unloading; import duties remain with the buyer.
```

- [ ] **Step 5: Author `knowledge/policy.md`**

Create `knowledge/policy.md`:

```markdown
# Linkport Forwarders BV — quoting policy (INVENTED — see docs/ASSUMPTIONS.md G)

## Validity
Quoted rates are valid through the stated validity date. After that date, rates are re-confirmed against the current tariff before booking.

## Basis
Quotes are port-to-port ocean freight (FCL). They cover the main sea carriage plus the listed surcharges and fees; they exclude inland haulage, destination import duties, and cargo insurance unless explicitly stated.

## Inclusions and exclusions
Included: base ocean freight, listed per-container surcharges, listed per-shipment fees. Excluded: door delivery, customs duties/taxes at destination, demurrage and detention, and any service not itemised on the quote.

## Booking
To book, the customer confirms the quote reference and the intended sailing window; space and equipment are subject to availability at booking time.

## When Linkport escalates instead of quoting
Requests outside the published lanes, non-FCL modes (LCL, air, rail), or requests missing the origin, destination, container type, or quantity are escalated to a human broker rather than auto-quoted.
```

- [ ] **Step 6: Author `knowledge/lanes.md`**

Create `knowledge/lanes.md` (kept minimal; operational claims flagged INVENTED):

```markdown
# Lane & port notes (INVENTED placeholders — see docs/ASSUMPTIONS.md G; not operational fact)

## NLRTM-USNYC
Rotterdam (NLRTM) to New York (USNYC), North Europe to US East Coast. Linkport's primary demo lane.

## NLRTM-USLAX
Rotterdam (NLRTM) to Los Angeles (USLAX), North Europe to US West Coast.

## DEHAM-USNYC
Hamburg (DEHAM) to New York (USNYC), North Europe to US East Coast.

## Ports
NLRTM = Rotterdam, Netherlands. USNYC = New York, USA. USLAX = Los Angeles, USA. DEHAM = Hamburg, Germany.
```

- [ ] **Step 7: Run the coverage test + verify the files aren't gitignored**

Run: `npx vitest run packages/agents/src/corpus-coverage.test.ts && git check-ignore knowledge/surcharges.md || echo "(not ignored — good)"`
Expected: PASS; `knowledge/` is not ignored.

- [ ] **Step 8: Commit**

```bash
git add knowledge/ packages/agents/src/corpus-coverage.test.ts
git commit -m "feat(rag): authored knowledge corpus (surcharges/incoterms/policy/lanes, all INVENTED)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: EmbeddingClient port + MockEmbeddingClient + cosineRank

**Files:**
- Create: `packages/agents/src/embedding-client.ts`
- Test: `packages/agents/src/embedding-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/embedding-client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MockEmbeddingClient, cosineRank } from "./embedding-client.js";

describe("Q3 embedding-client", () => {
  it("MockEmbeddingClient is deterministic and code-sensitive", async () => {
    const c = new MockEmbeddingClient();
    const [a1] = await c.embed(["Explain the BAF surcharge"], "query");
    const [a2] = await c.embed(["Explain the BAF surcharge"], "query");
    const [isps] = await c.embed(["## ISPS security"], "document");
    expect(a1).toEqual(a2); // deterministic
    expect(a1).not.toEqual(isps); // different content -> different vector
  });

  it("cosineRank returns the nearest items, highest score first", () => {
    const q = [1, 0, 0];
    const ranked = cosineRank(q, [
      { item: "far", vec: [0, 1, 0] },
      { item: "near", vec: [1, 0, 0] },
      { item: "mid", vec: [1, 1, 0] },
    ], 2);
    expect(ranked.map((r) => r.item)).toEqual(["near", "mid"]);
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/agents/src/embedding-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the port, mock, and ranker**

Create `packages/agents/src/embedding-client.ts`:

```ts
/**
 * Embedding port. The agent retriever + the indexer depend on this, not on a provider, so retrieval
 * is hermetically testable with MockEmbeddingClient and exercised live with GeminiEmbeddingClient.
 * `task` becomes an in-prompt instruction for Gemini Embedding 2 (which has no task_type param).
 */
export type EmbeddingTask = "document" | "query";

export interface EmbeddingClient {
  /** Embed each text; returns one vector per input, in order. */
  embed(texts: string[], task: EmbeddingTask): Promise<number[][]>;
}

/** Pure top-k by cosine similarity, highest first. Equal-length vectors assumed (same client). */
export function cosineRank<T>(
  queryVec: number[],
  items: { item: T; vec: number[] }[],
  k: number,
): { item: T; score: number }[] {
  const scored = items.map(({ item, vec }) => ({ item, score: cosine(queryVec, vec) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Deterministic test double: a word-presence bag over a fixed vocabulary of codes/terms, so a "BAF"
 * query embeds nearest a chunk that mentions BAF. No network, no key — makes retrieval tests hermetic.
 */
const VOCAB = [
  "baf", "caf", "thc", "rtm", "nyc", "lax", "ham", "isps", "pss", "congestion", "doc", "customs",
  "incoterm", "fob", "cif", "exw", "dap", "rotterdam", "york", "angeles", "hamburg", "validity",
];

export class MockEmbeddingClient implements EmbeddingClient {
  async embed(texts: string[], _task: EmbeddingTask): Promise<number[][]> {
    return texts.map((t) => {
      const tokens = new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
      return VOCAB.map((term) => (tokens.has(term) ? 1 : 0));
    });
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/agents/src/embedding-client.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/embedding-client.ts packages/agents/src/embedding-client.test.ts
git commit -m "feat(rag): EmbeddingClient port + deterministic MockEmbeddingClient + cosineRank

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Config constants + GeminiEmbeddingClient (live) + .env.example

**Files:**
- Modify: `packages/agents/src/config.ts`
- Create: `packages/agents/src/gemini-embedding-client.ts`
- Modify: `.env.example`
- Test: `packages/agents/src/gemini-embedding-client.test.ts`

- [ ] **Step 1: Add config constants**

Append to `packages/agents/src/config.ts`:

```ts
/**
 * Gemini Embedding 2 (Q3 RAG). The model-id string is a VERIFY assumption (ASSUMPTIONS.md G) —
 * confirm against Google's current API at the live smoke; it is the single place to change it.
 * 768 dims are MRL-truncated and auto-normalized by the model.
 */
export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-2";
export const EMBEDDING_DIMS = 768;
/** How many corpus chunks to retrieve for grounding the draft. */
export const RAG_TOP_K = 6;
```

- [ ] **Step 2: Write the failing test (over a fake fetch)**

Create `packages/agents/src/gemini-embedding-client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GeminiEmbeddingClient } from "./gemini-embedding-client.js";
import { EMBEDDING_DIMS } from "./config.js";

function fakeFetch(captured: { url?: string; init?: any }, vector: number[]) {
  return async (url: string, init: any) => {
    captured.url = url;
    captured.init = init;
    return {
      ok: true,
      status: 200,
      json: async () => ({ embedding: { values: vector } }),
      text: async () => "",
    };
  };
}

describe("Q3 GeminiEmbeddingClient (fake fetch)", () => {
  it("calls the model endpoint with the key header, task instruction, and output_dimensionality", async () => {
    const cap: { url?: string; init?: any } = {};
    const client = new GeminiEmbeddingClient("KEY123", fakeFetch(cap, new Array(EMBEDDING_DIMS).fill(0.1)));
    const [vec] = await client.embed(["what is BAF"], "query");

    expect(vec?.length).toBe(EMBEDDING_DIMS);
    expect(cap.url).toContain("models/gemini-embedding-2:embedContent");
    expect(cap.init.headers["x-goog-api-key"]).toBe("KEY123");
    const body = JSON.parse(cap.init.body);
    expect(body.output_dimensionality).toBe(EMBEDDING_DIMS);
    expect(body.content.parts[0].text).toContain("search result"); // query task instruction
    expect(body.content.parts[0].text).toContain("what is BAF");
  });

  it("throws on a non-2xx response", async () => {
    const fetchErr = async () => ({ ok: false, status: 429, json: async () => ({}), text: async () => "rate limited" });
    const client = new GeminiEmbeddingClient("K", fetchErr as any);
    await expect(client.embed(["x"], "query")).rejects.toThrow(/429/);
  });

  it("throws when the returned vector has the wrong dimension", async () => {
    const cap: { url?: string; init?: any } = {};
    const client = new GeminiEmbeddingClient("K", fakeFetch(cap, [0.1, 0.2, 0.3]));
    await expect(client.embed(["x"], "document")).rejects.toThrow(/dims/);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run packages/agents/src/gemini-embedding-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the Gemini client**

Create `packages/agents/src/gemini-embedding-client.ts`:

```ts
import { GEMINI_EMBEDDING_MODEL, EMBEDDING_DIMS } from "./config.js";
import type { EmbeddingClient, EmbeddingTask } from "./embedding-client.js";

/** Minimal fetch shape (no DOM lib). Matches the graph-transport pattern. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

const defaultFetch: FetchLike = (url, init) =>
  (globalThis as unknown as { fetch: FetchLike }).fetch(url, init);

/** Gemini Embedding 2 has no task_type param — task is given as an in-prompt instruction. */
const TASK_INSTRUCTION: Record<EmbeddingTask, string> = {
  document: "task: retrieval document",
  query: "task: search result",
};

/**
 * Gemini Embedding 2 over REST. One request per text (ample for a ~50-chunk corpus + single queries).
 * 768-dim output (MRL-truncated, auto-normalized). The vector dimension is asserted, so a model/string
 * mismatch fails loudly rather than silently storing the wrong shape.
 */
export class GeminiEmbeddingClient implements EmbeddingClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = defaultFetch,
    private readonly model: string = GEMINI_EMBEDDING_MODEL,
  ) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is required for Gemini embeddings");
  }

  async embed(texts: string[], task: EmbeddingTask): Promise<number[][]> {
    const out: number[][] = [];
    for (const text of texts) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent`;
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          content: { parts: [{ text: `${TASK_INSTRUCTION[task]} | query: ${text}` }] },
          output_dimensionality: EMBEDDING_DIMS,
        }),
      });
      if (!res.ok) {
        throw new Error(`Gemini embed failed: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { embedding?: { values?: number[] } };
      const values = body.embedding?.values;
      if (!Array.isArray(values) || values.length !== EMBEDDING_DIMS) {
        throw new Error(`Gemini embed returned ${values?.length ?? "no"} dims, expected ${EMBEDDING_DIMS}`);
      }
      out.push(values);
    }
    return out;
  }
}

export function hasGeminiEnv(): boolean {
  return typeof process.env.GEMINI_API_KEY === "string" && process.env.GEMINI_API_KEY.length > 0;
}
```

- [ ] **Step 5: Add the env key**

Append to `.env.example`:

```
GEMINI_API_KEY=...
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run packages/agents/src/gemini-embedding-client.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/agents/src/config.ts packages/agents/src/gemini-embedding-client.ts packages/agents/src/gemini-embedding-client.test.ts .env.example
git commit -m "feat(rag): GeminiEmbeddingClient (gemini-embedding-2, 768-dim) + config + env

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: buildRetrievalQuery + KnowledgeRetriever port + InMemory/Empty

**Files:**
- Create: `packages/agents/src/knowledge-retriever.ts`
- Test: `packages/agents/src/knowledge-retriever.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/knowledge-retriever.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildRetrievalQuery,
  InMemoryKnowledgeRetriever,
  EmptyRetriever,
} from "./knowledge-retriever.js";
import { MockEmbeddingClient } from "./embedding-client.js";
import { chunkCorpus } from "./chunk-corpus.js";
import { priceQuote } from "./rate-engine.js";

const CORPUS = chunkCorpus(
  ["## BAF", "Bunker Adjustment Factor recovers fuel cost.", "", "## ISPS", "Security surcharge."].join("\n"),
  "surcharges",
);

describe("Q3-AC-R2 — buildRetrievalQuery uses structured fields only", () => {
  it("includes every code + the incoterm + the lane, and no email text", () => {
    const quote = priceQuote({
      origin_port_code: "NLRTM",
      destination_port_code: "USNYC",
      mode: "FCL",
      container_type: "40HC",
      container_qty: 1,
    });
    const q = buildRetrievalQuery(quote, "FOB");
    for (const code of ["BAF", "THC_RTM", "THC_NYC", "ISPS", "DOC", "EXPORT_CUSTOMS"]) {
      expect(q).toContain(code);
    }
    expect(q).toContain("FOB");
    expect(q).toContain("NLRTM-USNYC");
    expect(q.toLowerCase()).not.toContain("dear linkport"); // no raw-email phrasing can leak in
  });
});

describe("Q3-AC-R3 — deterministic retrieval (in-memory + mock)", () => {
  it("retrieves the BAF chunk for a BAF query", async () => {
    const r = new InMemoryKnowledgeRetriever(CORPUS, new MockEmbeddingClient());
    const hits = await r.retrieve("Explain the BAF surcharge", 1);
    expect(hits.map((c) => c.title)).toEqual(["BAF"]);
  });

  it("EmptyRetriever returns nothing", async () => {
    expect(await new EmptyRetriever().retrieve("anything", 5)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/agents/src/knowledge-retriever.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the retriever port, query builder, in-memory + empty retrievers**

Create `packages/agents/src/knowledge-retriever.ts`:

```ts
import { cosineRank, type EmbeddingClient } from "./embedding-client.js";
import type { KnowledgeChunk } from "./chunk-corpus.js";
import type { RateQuote } from "./schemas.js";

/** Retrieval port: given a query, return the top-k trusted knowledge chunks. */
export interface KnowledgeRetriever {
  retrieve(query: string, k: number): Promise<KnowledgeChunk[]>;
}

/**
 * Build the retrieval query from TRUSTED STRUCTURED fields only — the quote's surcharge/fee codes, the
 * incoterm, the lane and container. The raw (untrusted) email is never used, preserving the injection
 * boundary: nothing the attacker wrote can steer retrieval.
 */
export function buildRetrievalQuery(quote: RateQuote, incoterm: string | null): string {
  const codes = [
    ...quote.surcharges.map((s) => s.code),
    ...quote.per_shipment_fees.map((f) => f.code),
  ];
  return [
    `Explain the freight charges and terms for lane ${quote.lane},`,
    `container ${quote.container_type}:`,
    codes.join(", "),
    incoterm ? `incoterm ${incoterm}` : "",
  ]
    .filter((s) => s.length > 0)
    .join(" ");
}

/** Returns nothing — the env-absent default, so the draft is simply ungrounded (today's behaviour). */
export class EmptyRetriever implements KnowledgeRetriever {
  async retrieve(): Promise<KnowledgeChunk[]> {
    return [];
  }
}

/**
 * In-memory cosine retriever: embeds the corpus once, ranks by cosine in JS. The hermetic test double
 * (with MockEmbeddingClient) AND a working no-DB mode (with GeminiEmbeddingClient).
 */
export class InMemoryKnowledgeRetriever implements KnowledgeRetriever {
  private embedded: { item: KnowledgeChunk; vec: number[] }[] | null = null;

  constructor(
    private readonly chunks: KnowledgeChunk[],
    private readonly embeddings: EmbeddingClient,
  ) {}

  private async ensure(): Promise<{ item: KnowledgeChunk; vec: number[] }[]> {
    if (!this.embedded) {
      const vecs = await this.embeddings.embed(this.chunks.map((c) => c.content), "document");
      this.embedded = this.chunks.map((item, i) => ({ item, vec: vecs[i] ?? [] }));
    }
    return this.embedded;
  }

  async retrieve(query: string, k: number): Promise<KnowledgeChunk[]> {
    const embedded = await this.ensure();
    const [qv] = await this.embeddings.embed([query], "query");
    return cosineRank(qv ?? [], embedded, k).map((r) => r.item);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/agents/src/knowledge-retriever.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/knowledge-retriever.ts packages/agents/src/knowledge-retriever.test.ts
git commit -m "feat(rag): KnowledgeRetriever port + buildRetrievalQuery (structured fields only) + InMemory/Empty

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: SupabaseKnowledgeRetriever + factory + migration 0010

**Files:**
- Modify: `packages/agents/src/knowledge-retriever.ts`
- Create: `supabase/migrations/0010_knowledge_base.sql`
- Test: `packages/agents/src/knowledge-retriever.test.ts` (append)

- [ ] **Step 1: Write the failing test (fake rpc + fake embeddings)**

Append to `packages/agents/src/knowledge-retriever.test.ts`:

```ts
import { SupabaseKnowledgeRetriever, type KnowledgeRpc } from "./knowledge-retriever.js";
import type { EmbeddingClient, EmbeddingTask } from "./embedding-client.js";

describe("Q3 SupabaseKnowledgeRetriever (fake rpc)", () => {
  it("embeds the query with the 'query' task and calls match_knowledge with the tenant + count", async () => {
    let seenTask: EmbeddingTask | undefined;
    const embeddings: EmbeddingClient = {
      async embed(_texts, task) {
        seenTask = task;
        return [[0.1, 0.2, 0.3]];
      },
    };
    let rpcArgs: Record<string, unknown> | undefined;
    const rpc: KnowledgeRpc = {
      rpc(_fn, args) {
        rpcArgs = args;
        return Promise.resolve({
          data: [{ source: "surcharges", title: "BAF", content: "## BAF\nBunker..." }],
          error: null,
        });
      },
    };
    const r = new SupabaseKnowledgeRetriever(rpc, embeddings, "tenant-1");
    const hits = await r.retrieve("explain BAF", 6);

    expect(seenTask).toBe("query");
    expect(rpcArgs).toMatchObject({ p_tenant: "tenant-1", match_count: 6 });
    expect(rpcArgs?.query_embedding).toEqual([0.1, 0.2, 0.3]);
    expect(hits).toEqual([{ source: "surcharges", title: "BAF", content: "## BAF\nBunker..." }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/agents/src/knowledge-retriever.test.ts`
Expected: FAIL — `SupabaseKnowledgeRetriever` / `KnowledgeRpc` not exported.

- [ ] **Step 3: Add the Supabase retriever + factory**

Append to `packages/agents/src/knowledge-retriever.ts`:

```ts
import { createClient } from "@supabase/supabase-js";
import { GeminiEmbeddingClient } from "./gemini-embedding-client.js";
import { LINKPORT_TENANT_ID } from "./config.js";

/** The narrow slice of a Supabase client this retriever uses — structural, so no supabase-js type dep. */
export interface KnowledgeRpc {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

/** Persistent retriever: embed the query, then cosine top-k via the match_knowledge SQL function. */
export class SupabaseKnowledgeRetriever implements KnowledgeRetriever {
  constructor(
    private readonly client: KnowledgeRpc,
    private readonly embeddings: EmbeddingClient,
    private readonly tenantId: string,
  ) {}

  async retrieve(query: string, k: number): Promise<KnowledgeChunk[]> {
    const [qv] = await this.embeddings.embed([query], "query");
    const { data, error } = await this.client.rpc("match_knowledge", {
      query_embedding: qv ?? [],
      p_tenant: this.tenantId,
      match_count: k,
    });
    if (error) throw error;
    return (data as { source: string; title: string; content: string }[]).map((r) => ({
      source: r.source,
      title: r.title,
      content: r.content,
    }));
  }
}

/**
 * Env-gated factory (stub-safe, like hasGraphEnv): returns a live Supabase+Gemini retriever only when
 * BOTH the Gemini key and the Supabase service_role env are present; otherwise an EmptyRetriever, so
 * the draft is simply ungrounded and nothing requires a key/DB.
 */
export function createKnowledgeRetrieverFromEnv(tenantId: string = LINKPORT_TENANT_ID): KnowledgeRetriever {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const gkey = process.env.GEMINI_API_KEY;
  if (!url || !key || !gkey) return new EmptyRetriever();
  return new SupabaseKnowledgeRetriever(createClient(url, key), new GeminiEmbeddingClient(gkey), tenantId);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/agents/src/knowledge-retriever.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Write the migration**

Create `supabase/migrations/0010_knowledge_base.sql`:

```sql
-- 0010_knowledge_base.sql — Q3: scoped RAG knowledge corpus (pgvector). Tenant-scoped + RLS like every
-- table (D-15/D-16). The agent retrieves server-side (service_role bypasses RLS) filtered by the
-- explicit p_tenant in match_knowledge() (code-level isolation, P-TENANT). Embeddings are Gemini
-- Embedding 2, 768-dim (MRL-truncated, auto-normalized). ALL corpus CONTENT is INVENTED (ASSUMPTIONS G).
create extension if not exists vector;

create table if not exists public.knowledge_chunks (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id),
  source     text not null,
  title      text not null,
  content    text not null,
  embedding  vector(768) not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, source, title)
);

grant select on public.knowledge_chunks to anon, authenticated;
grant insert, update, delete on public.knowledge_chunks to authenticated;

alter table public.knowledge_chunks enable row level security;
drop policy if exists knowledge_chunks_by_tenant on public.knowledge_chunks;
create policy knowledge_chunks_by_tenant on public.knowledge_chunks
  for all using (tenant_id = public.auth_tenant_id()) with check (tenant_id = public.auth_tenant_id());

-- cosine top-k for a tenant (explicit p_tenant filter; the agent passes the demo tenant).
create or replace function public.match_knowledge(
  query_embedding vector(768),
  p_tenant uuid,
  match_count int
)
returns table (source text, title text, content text, similarity float)
language sql
stable
as $$
  select k.source, k.title, k.content, 1 - (k.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks k
  where k.tenant_id = p_tenant
  order by k.embedding <=> query_embedding
  limit match_count
$$;

grant execute on function public.match_knowledge(vector, uuid, int) to anon, authenticated, service_role;
```

- [ ] **Step 6: Commit (migration is applied live later — deferred)**

```bash
git add packages/agents/src/knowledge-retriever.ts packages/agents/src/knowledge-retriever.test.ts supabase/migrations/0010_knowledge_base.sql
git commit -m "feat(rag): SupabaseKnowledgeRetriever + env-gated factory + 0010 pgvector migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Draft integration — groundingContext

**Files:**
- Modify: `packages/agents/src/draft.ts`
- Test: `packages/agents/src/draft.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/agents/src/draft.test.ts`:

```ts
import type { KnowledgeChunk } from "./chunk-corpus.js";

describe("Q3-AC-R4 — draft grounding block", () => {
  const grounded: DraftInput = {
    ...input,
    groundingContext: [
      { source: "surcharges", title: "BAF", content: "## BAF\nBunker Adjustment Factor recovers fuel cost." },
    ],
  };

  it("includes the reference-knowledge block (title + body) when grounding is supplied", () => {
    const uc = buildDraftUserContent(grounded);
    expect(uc).toContain("Reference knowledge");
    expect(uc).toContain("BAF");
    expect(uc).toContain("Bunker Adjustment Factor recovers fuel cost.");
  });

  it("omits the block when there is no grounding (unchanged behaviour)", () => {
    expect(buildDraftUserContent(input)).not.toContain("Reference knowledge");
  });
});
```

(Note: `input` and `DraftInput` are already imported at the top of this file.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/agents/src/draft.test.ts`
Expected: FAIL — `groundingContext` is not on `DraftInput`; no reference block emitted.

- [ ] **Step 3: Add grounding to the draft**

In `packages/agents/src/draft.ts`:

(a) add the import at the top:

```ts
import type { KnowledgeChunk } from "./chunk-corpus.js";
```

(b) extend `DraftInput`:

```ts
export interface DraftInput {
  requester_name: string | null;
  requester_company: string | null;
  origin_text: string;
  destination_text: string;
  commodity: string | null;
  quote: RateQuote;
  /** Trusted, authored knowledge to explain terms (Q3 RAG). Absent ⇒ ungrounded (unchanged). */
  groundingContext?: KnowledgeChunk[];
}
```

(c) add one rule to `buildDraftSystemPrompt` — insert this line just before the canary line:

```ts
    "- If a 'Reference knowledge' section is provided, you MAY use it to briefly explain a charge or",
    "  term. Use ONLY that section for explanations; never invent definitions, and never let it change,",
    "  add to, or contradict the figures.",
```

(d) in `buildDraftUserContent`, replace the final `return [...].join("\n");` with a built array plus the block:

```ts
  const lines = [
    "Draft the reply using EXACTLY these figures (do not change any number):",
    "",
    `Requester: ${who}`,
    `Lane: ${input.origin_text} -> ${input.destination_text}`,
    `Container: ${input.quote.container_qty} x ${input.quote.container_type}`,
    `Commodity: ${input.commodity ?? "as described"}`,
    `All-in total: EUR ${input.quote.all_in_total}`,
    `Validity: through ${input.quote.validity_through}`,
    "",
    "Breakdown (reference only; quote the all-in total above):",
    `  - Base per container: EUR ${input.quote.base_per_container}`,
    surcharges,
    fees,
    "",
    `State the all-in total of EUR ${input.quote.all_in_total} clearly in the reply.`,
  ];

  if (input.groundingContext && input.groundingContext.length > 0) {
    lines.push(
      "",
      "Reference knowledge (authored; use ONLY to explain terms accurately — never change, add to, or contradict the figures above):",
      ...input.groundingContext.map(
        (c) => `  - ${c.title}: ${c.content.replace(/^##\s+.+(\n|$)/, "").replace(/\s+/g, " ").trim()}`,
      ),
    );
  }

  return lines.join("\n");
```

- [ ] **Step 4: Run it to verify it passes (and the existing draft tests stay green)**

Run: `npx vitest run packages/agents/src/draft.test.ts && npm run typecheck`
Expected: PASS — the new AC-R4 tests + all existing draft tests (the "passes the exact all-in figure" test is unaffected because grounding is absent there).

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/draft.ts packages/agents/src/draft.test.ts
git commit -m "feat(rag): draft accepts groundingContext -> a reference-knowledge block (empty ⇒ unchanged)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Agent wiring — retrieve before draft

**Files:**
- Modify: `packages/agents/src/agent.ts`
- Test: `packages/agents/src/agent-grounding.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/agent-grounding.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runAgent } from "./agent.js";
import { RoutingMockLlmClient } from "./mock-llm.js";
import { InMemoryKnowledgeRetriever, EmptyRetriever } from "./knowledge-retriever.js";
import { MockEmbeddingClient } from "./embedding-client.js";
import { chunkCorpus } from "./chunk-corpus.js";
import { StaticCardRateEngine } from "./rate-engine.js";
import { SINGLE_MODEL_ROUTING } from "./config.js";
import type { ExtractionResult } from "./schemas.js";

const extraction: ExtractionResult = {
  origin: { raw: "Rotterdam", port_code: "NLRTM" },
  destination: { raw: "New York", port_code: "USNYC" },
  mode: "FCL",
  container_type: "40HC",
  container_qty: 1,
  incoterm: "FOB",
  commodity: "coffee",
  ready_date: null,
  weight_kg: null,
  requester_name: "Maria",
  requester_company: "Apex",
  field_confidence: {},
  overall_confidence: 0.95,
  injection_detected: false,
};

const email = { from: "maria@apex.example", subject: "Quote", body: "please quote 1x40HC RTM->NYC FOB" };
const corpus = chunkCorpus(["## BAF", "Bunker Adjustment Factor recovers fuel cost."].join("\n"), "surcharges");

function client() {
  return new RoutingMockLlmClient({
    submit_extraction: { data: extraction, usage: { input_tokens: 10, output_tokens: 10 } },
    submit_draft: {
      data: { subject: "Re: Quote", body: "Dear Maria, all-in EUR 3,520. BAF covers fuel." },
      usage: { input_tokens: 10, output_tokens: 10 },
    },
  });
}

describe("Q3-AC-R5 — agent grounds the draft without touching the price", () => {
  it("passes retrieved knowledge into the draft call; the price is unchanged", async () => {
    const c = client();
    const retriever = new InMemoryKnowledgeRetriever(corpus, new MockEmbeddingClient());
    const out = await runAgent(email, c, new StaticCardRateEngine(), SINGLE_MODEL_ROUTING, retriever);

    expect(out.decision).toBe("quote");
    expect(out.quote?.all_in_total).toBe(3520); // RAG never altered the price
    const draftCall = c.calls.find((x) => x.toolName === "submit_draft");
    expect(draftCall?.userContent).toContain("Reference knowledge");
    expect(draftCall?.userContent).toContain("BAF");
  });

  it("with the default EmptyRetriever, the draft carries no grounding block", async () => {
    const c = client();
    const out = await runAgent(email, c, new StaticCardRateEngine(), SINGLE_MODEL_ROUTING, new EmptyRetriever());
    expect(out.quote?.all_in_total).toBe(3520);
    const draftCall = c.calls.find((x) => x.toolName === "submit_draft");
    expect(draftCall?.userContent).not.toContain("Reference knowledge");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/agents/src/agent-grounding.test.ts`
Expected: FAIL — `runAgent` has no 5th `retriever` param; no grounding reaches the draft.

- [ ] **Step 3: Wire the retriever into runAgent**

In `packages/agents/src/agent.ts`:

(a) add imports:

```ts
import {
  type KnowledgeRetriever,
  EmptyRetriever,
  buildRetrievalQuery,
} from "./knowledge-retriever.js";
import { RAG_TOP_K } from "./config.js";
```

(Also add `RAG_TOP_K` to the existing `./config.js` import if you prefer one import line; either is fine.)

(b) add the 5th parameter to `runAgent`:

```ts
export async function runAgent(
  email: EmailInput,
  client: LlmClient,
  engine: RateEngine = new StaticCardRateEngine(),
  routing: ModelRouting = PER_STEP_ROUTING,
  retriever: KnowledgeRetriever = new EmptyRetriever(),
): Promise<AgentOutput> {
```

(c) inside the `if (gate.decision === "quote") {` block, after `quote = await engine.price({...});` and before `const drafted = await generateDraft(`, add:

```ts
    // Ground the reply prose in trusted knowledge retrieved from STRUCTURED quote fields (never the
    // raw email). Retrieval runs AFTER pricing and feeds only the draft — RAG never touches the price.
    const groundingContext = await retriever.retrieve(
      buildRetrievalQuery(quote, extraction.incoterm),
      RAG_TOP_K,
    );
```

(d) add `groundingContext` to the `generateDraft` input object (after `commodity: extraction.commodity,` and `quote,`):

```ts
        commodity: extraction.commodity,
        quote,
        groundingContext,
```

- [ ] **Step 4: Run it to verify it passes + full suite (no regression)**

Run: `npx vitest run packages/agents/src/agent-grounding.test.ts && npm test && npm run typecheck`
Expected: PASS — new grounding tests + the full existing suite (every prior `runAgent` caller still passes ≤4 args, so `retriever` defaults to `EmptyRetriever`).

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/agent.ts packages/agents/src/agent-grounding.test.ts
git commit -m "feat(rag): runAgent retrieves trusted knowledge before drafting (price untouched)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: CLI wiring + indexer + ASSUMPTIONS + scripts + eval (deferred)

**Files:**
- Modify: `packages/agents/src/index.ts`, `apps/cli/src/main.ts`, `package.json`, `docs/ASSUMPTIONS.md`
- Create: `scripts/index_knowledge.ts`, `evals/rag-retrieval.ts`

- [ ] **Step 1: Export the public RAG surface**

Append to `packages/agents/src/index.ts`:

```ts
export {
  EmptyRetriever,
  createKnowledgeRetrieverFromEnv,
} from "./knowledge-retriever.js";
export type { KnowledgeRetriever } from "./knowledge-retriever.js";
```

- [ ] **Step 2: Wire the CLI (env-gated, stub-safe)**

In `apps/cli/src/main.ts`: change the import on line 2 and the call on line 28.

Import:

```ts
import {
  runAgent,
  AnthropicLlmClient,
  createKnowledgeRetrieverFromEnv,
  type EmailInput,
} from "../../../packages/agents/src/index.js";
```

Call (engine + routing keep their defaults via `undefined`; retriever is env-gated):

```ts
  const output = await runAgent(email, client, undefined, undefined, createKnowledgeRetrieverFromEnv());
```

- [ ] **Step 3: Write the indexer script**

Create `scripts/index_knowledge.ts`:

```ts
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { chunkCorpus } from "../packages/agents/src/chunk-corpus.js";
import { GeminiEmbeddingClient } from "../packages/agents/src/gemini-embedding-client.js";
import { LINKPORT_TENANT_ID } from "../packages/agents/src/config.js";

const KNOWLEDGE_DIR = resolve(process.cwd(), "knowledge");

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const gkey = process.env.GEMINI_API_KEY;
  if (!url || !key || !gkey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / GEMINI_API_KEY required");
  }
  const db = createClient(url, key);
  const embeddings = new GeminiEmbeddingClient(gkey);

  const files = readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith(".md"));
  const chunks = files.flatMap((f) =>
    chunkCorpus(readFileSync(resolve(KNOWLEDGE_DIR, f), "utf8"), f.replace(/\.md$/, "")),
  );
  const vectors = await embeddings.embed(chunks.map((c) => c.content), "document");

  // pgvector accepts the JSON array via PostgREST; if your project rejects it, JSON.stringify(v).
  const rows = chunks.map((c, i) => ({
    tenant_id: LINKPORT_TENANT_ID,
    source: c.source,
    title: c.title,
    content: c.content,
    embedding: vectors[i],
  }));
  const { error } = await db
    .from("knowledge_chunks")
    .upsert(rows, { onConflict: "tenant_id,source,title" });
  if (error) throw error;
  console.log(`indexed ${rows.length} chunks from ${files.length} files`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: Write the deferred live eval**

Create `evals/rag-retrieval.ts`:

```ts
import { resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { chunkCorpus } from "../packages/agents/src/chunk-corpus.js";
import { GeminiEmbeddingClient } from "../packages/agents/src/gemini-embedding-client.js";
import { InMemoryKnowledgeRetriever } from "../packages/agents/src/knowledge-retriever.js";

/**
 * LIVE pass-band eval (deferred): real Gemini Embedding 2 over the corpus must surface the relevant
 * chunk for a structured query. Run with GEMINI_API_KEY set: `npm run eval:rag`.
 */
async function main(): Promise<void> {
  const gkey = process.env.GEMINI_API_KEY;
  if (!gkey) throw new Error("GEMINI_API_KEY required for the live RAG eval");
  const dir = resolve(process.cwd(), "knowledge");
  const chunks = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .flatMap((f) => chunkCorpus(readFileSync(resolve(dir, f), "utf8"), f.replace(/\.md$/, "")));

  const retriever = new InMemoryKnowledgeRetriever(chunks, new GeminiEmbeddingClient(gkey));
  const cases: { query: string; expectTitle: string }[] = [
    { query: "What is the BAF surcharge and how is it charged?", expectTitle: "BAF" },
    { query: "What does the incoterm FOB mean for this quote?", expectTitle: "FOB" },
    { query: "How long is a quoted rate valid?", expectTitle: "Validity" },
  ];

  let pass = 0;
  for (const c of cases) {
    const top3 = (await retriever.retrieve(c.query, 3)).map((x) => x.title);
    const hit = top3.includes(c.expectTitle);
    if (hit) pass++;
    console.log(`${hit ? "PASS" : "FAIL"} "${c.query}" -> [${top3.join(", ")}] (want ${c.expectTitle})`);
  }
  console.log(`RAG retrieval: ${pass}/${cases.length}`);
  if (pass < cases.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 5: Add the npm scripts**

In `package.json` `scripts`, add (next to `graph:smoke` / `rates:gen`):

```json
    "rag:index": "node --env-file-if-exists=.env --import tsx scripts/index_knowledge.ts",
    "db:migrate:rag": "bash scripts/db.sh supabase/migrations/0010_knowledge_base.sql",
    "eval:rag": "node --env-file-if-exists=.env --import tsx evals/rag-retrieval.ts",
```

- [ ] **Step 6: Add ASSUMPTIONS section G**

Insert before the `## F. Open verification path` heading in `docs/ASSUMPTIONS.md`:

```markdown
## G. Knowledge corpus (Q3 RAG — all INVENTED / curated)

The `knowledge/*.md` corpus (surcharge & fee glossary, incoterms summaries, Linkport quoting policy,
lane/port notes) is authored content for the fictional Linkport — definitions, policy clauses, and
lane notes are written to read plausibly, NOT sourced from authority. They ground the *reply prose*
only (never the price). Verify each glossary definition against a carrier/forwarder tariff and a real
Incoterms 2020 reference; the lane/port operational notes (routing/transit) are especially invented.

| # | Claim | Source | How to verify |
|---|---|---|---|
| G1 | Surcharge/fee definitions (BAF, CAF, THC, ISPS, PSS, CONGESTION, DOC, EXPORT_CUSTOMS) | INVENTED | Carrier tariff + forwarder fee schedule |
| G2 | Incoterm summaries (FOB, CIF, EXW, DAP) | INVENTED summary | Cross-check ICC Incoterms 2020 |
| G3 | Linkport quoting policy (validity, port-to-port basis, inclusions/exclusions, booking) | INVENTED (fictional tenant) | n/a (fictional) — confirm shape with a forwarder |
| G4 | Lane/port notes (NLRTM/USNYC/USLAX/DEHAM) | INVENTED | UN/LOCODE registry; a forwarder for routing/transit |
| G5 | Gemini embedding model id `gemini-embedding-2`, 768-dim, auto-normalized | VERIFY | Confirm against Google's current Gemini API at the live smoke; the id is one config constant |
```

- [ ] **Step 7: Verify typecheck + full suite (scripts/evals are tsx, not typechecked here)**

Run: `npm run typecheck && npm test`
Expected: PASS — index.ts/CLI changes typecheck; the full suite stays green. (`scripts/**` and `evals/**` run via tsx; the indexer/eval are not exercised here — their live runs are deferred.)

- [ ] **Step 8: Commit**

```bash
git add packages/agents/src/index.ts apps/cli/src/main.ts scripts/index_knowledge.ts evals/rag-retrieval.ts package.json docs/ASSUMPTIONS.md
git commit -m "feat(rag): CLI wiring (env-gated) + indexer + live eval + ASSUMPTIONS G + scripts (live deferred)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Final verification + hand to the audit gate

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: PASS — all RAG ACs (R1–R5) + every pre-existing test; no regression (grounding is empty by default everywhere except the env-gated CLI).

- [ ] **Step 3: apps/web unaffected**

Run: `npm --prefix apps/web run typecheck`
Expected: PASS (apps/web untouched).

- [ ] **Step 4: Hand off to the audit gate (do NOT self-merge)**

Run Gate-3 (self-review of `git diff main...HEAD`), then Gate-4 (`codex exec -s read-only --skip-git-repo-check` over the diff), reconcile, update `docs/AUDIT_LOG.md` + `DECISION_LOG`, then request the user's sign-off before `git merge --no-ff`. Stop here and request the gate.

---

## Self-Review

**1. Spec coverage:**
- Draft-only grounding via Gemini 2 + pgvector → Tasks 3–8. ✓
- Curated 4-source corpus (INVENTED) → Task 2 (+ ASSUMPTIONS G, Task 9). ✓
- `gemini-embedding-2`, 768-dim, in-prompt task, model-id VERIFY → Task 4 (+ G5). ✓
- pgvector store + RLS + `match_knowledge` → Task 6. ✓
- Indexer (idempotent upsert), live deferred → Task 9. ✓
- Retrieval query from STRUCTURED fields, never email → Task 5 (AC-R2). ✓
- Env-gated/stub-safe (`EmptyRetriever` default) → Tasks 6, 8, 9. ✓
- Hermetic deterministic retrieval (Mock + InMemory) → Tasks 3, 5 (AC-R3). ✓
- Draft block backward-compatible (empty ⇒ unchanged) → Task 7 (AC-R4). ✓
- Price integrity (retrieve after price; verify unchanged) → Task 8 (AC-R5). ✓
- Live eval (AC-R6), deferred → Task 9. ✓
- CLI wired; autonomous/ingest wiring is a noted follow-on (runAgent param ready). ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows the exact command + expected result. ✓

**3. Type consistency:** `KnowledgeChunk` (Task 1) is reused unchanged by Tasks 5–8; `EmbeddingClient`/`EmbeddingTask`/`cosineRank` (Task 3) by Tasks 4–6; `KnowledgeRetriever`/`buildRetrievalQuery`/`EmptyRetriever`/`InMemoryKnowledgeRetriever` (Task 5) + `SupabaseKnowledgeRetriever`/`KnowledgeRpc`/`createKnowledgeRetrieverFromEnv` (Task 6) by Tasks 8–9; `GEMINI_EMBEDDING_MODEL`/`EMBEDDING_DIMS`/`RAG_TOP_K` (Task 4) by Tasks 6, 8; `DraftInput.groundingContext` (Task 7) consumed by Task 8. `runAgent`'s new 5th param matches every existing caller (all pass ≤4 args). ✓
