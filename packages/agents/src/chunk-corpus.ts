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
