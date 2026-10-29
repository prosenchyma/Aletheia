import { askJson } from "./llm";
import { searchWeb, hostOf, Source } from "./tavily";
import { Claim } from "./extract";
import { domainTrust } from "./trust";

const STANCE_RUNS = Number(process.env.STANCE_RUNS ?? 1);

export type Verdict =
  | "supported"
  | "mostly_supported"
  | "mixed"
  | "mostly_contradicted"
  | "contradicted"
  | "unsupported"
  | "unsupported_absolute"
  | "insufficient";

export type Evidence = { url: string; quote: string; stance: string };

export type Judgment = {
  claim: Claim;
  verdict: Verdict;
  consensus: string;
  explanation: string;
  evidence: Evidence[];
  sources: Source[];
  ignored: number;
};

// "unsupported" (no evidence either way) is not scored.
// "unsupported_absolute" (flat superlative with no backing) scores low.
export const POINTS: Record<Verdict, number | null> = {
  supported: 100,
  mostly_supported: 80,
  mixed: 50,
  mostly_contradicted: 20,
  contradicted: 0,
  unsupported: null,
  unsupported_absolute: 10,
  insufficient: null,
};

export function claimWeight(c: Claim): number {
  if (c.kind === "attribution") return 2;
  if (c.absolute) return Math.min(c.centrality, 2);
  if (c.kind === "embedded") return 2;
  return c.centrality;
}

const SYSTEM = `You are a skeptical fact-checker. You receive ONE claim and numbered web sources.
For EACH source decide its stance toward the claim. Use ONLY the sources, not your own memory.

Stances:
- supports: the source gives evidence (data, a study, an official record, direct documentation) that confirms the claim AS STATED, including its full scope.
- partial: the source confirms only a weaker or narrower version (for example the claim says all, every or most, but the source only shows some).
- contradicts: the source gives evidence that the claim is false or that the opposite is true.
- repeats: the source merely repeats, reports or quotes the claim, or says that someone said it, without independent evidence. Opinion pieces and the speaker's own statements are repeats.
- neutral: relevant, but does not settle the question.
- irrelevant: unrelated.

Rules:
1. Someone saying something, or an article reporting that someone said it, is NOT evidence that it is true. Mark it "repeats". Exception: if the claim itself is about whether the person said it (CLAIM KIND: attribution), a reliable report that they said it is "supports".
2. For sweeping generalizations (all, every, always, never, or a trait ascribed to a whole group of people), "supports" requires that the source explicitly establishes it for the whole group as stated. Otherwise use "partial" or "contradicts".
3. Be strict. If unsure between "supports" and something weaker, choose the weaker one.
4. quote: exact words copied from the source (max 25 words) that justify your stance. Empty string for repeats, neutral and irrelevant.
5. consensus: "consensus" if reliable sources broadly agree, "disputed" if they disagree, "minority_view" if few experts hold the claim, else "unknown".
6. Sources may be in a different language than the claim. Judge the meaning, not the wording.
7. For claims about what something is (a definition, a method, a book, a tool, a person's work), a reliable source that describes it the same way supports the claim, even if the wording is different.
8. For absolute or superlative claims (nobody, never, always, the best ever, better than anyone), "supports" requires a reliable source that explicitly establishes it, such as records, rankings or official data. A source that merely mentions the claim, praises the person, or repeats it is "repeats", not "supports".

Return ONLY JSON:
{"consensus":"...","explanation":"1-2 sentences describing what the independent sources show. Do not state a verdict.","sources":[{"i":1,"reason":"max 15 words: what this source says about the claim","stance":"...","quote":"..."}]}
Write the reason first, then choose the stance that follows from it. Every source must appear exactly once.
Inside strings never use double quote characters (use single quotes) and never use line breaks.`;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

// Share of the input text's 6-word phrases that also appear in a source.
function overlapRatio(text: string, content: string): number {
  const w = norm(text).split(" ").filter(Boolean);
  const shingles = new Set<string>();
  for (let i = 0; i + 6 <= w.length; i++) shingles.add(w.slice(i, i + 6).join(" "));
  if (shingles.size === 0) return 0;
  const c = norm(content);
  let hit = 0;
  for (const sh of shingles) if (c.includes(sh)) hit++;
  return hit / shingles.size;
}

function verdictFromStances(items: { stance: string; trust: number }[]): Verdict {
  let s = 0, p = 0, c = 0, strongSupport = false, supporters = 0;
  for (const it of items) {
    if (it.stance === "supports") {
      s += it.trust;
      supporters++;
      if (it.trust === 1) strongSupport = true;
    } else if (it.stance === "partial") p += it.trust;
    else if (it.stance === "contradicts") c += it.trust;
  }
  const support = s + 0.25 * p;
  const against = c + 0.75 * p;
  const total = support + against;
  if (total === 0) return "insufficient";
  const r = support / total;
  let v: Verdict =
    r >= 0.85 ? "supported"
    : r >= 0.65 ? "mostly_supported"
    : r >= 0.35 ? "mixed"
    : r >= 0.15 ? "mostly_contradicted"
    : "contradicted";
  if (v === "supported" && supporters < 2 && !strongSupport) v = "mostly_supported";
  return v;
}

function majority(votes: string[], fallback: string): string {
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return n >= 2 || votes.length === 1 ? best : fallback;
}

// What to say when the sources give no usable answer
function noEvidenceVerdict(claim: Claim): Verdict {
  if (claim.kind === "attribution") return "insufficient";
  if (claim.absolute) return "unsupported_absolute";
  return "unsupported";
}

function explain(verdict: Verdict, fromModel: string): string {
  if (verdict === "unsupported_absolute") {
    return "This is stated as a flat fact, but it is an absolute or superlative claim and no reliable source explicitly supports it. If it is only the author's view, it should be framed as one.";
  }
  if (verdict === "unsupported") {
    return "No independent source was found either way. This does not mean the claim is false; it could not be verified.";
  }
  return fromModel;
}

export async function judgeClaim(
  claim: Claim,
  ctx: { text: string; excludeDomains: string[] }
): Promise<Judgment> {
  const queries = [
    ...new Set(
      [claim.query, claim.query_en].filter((x): x is string => !!x && x.length > 5)
    ),
  ];
  if (queries.length === 0) queries.push(claim.text);
  if (queries.length === 1) queries.push(`${queries[0]} fact check`);
  const found = await searchWeb(queries, ctx.excludeDomains);

  // Throw away sources from the same page/site, and copies of the input text
  const checkEcho = claim.kind !== "attribution" && wordCount(ctx.text) >= 40;
  let ignored = 0;
  const usable = found.filter((s) => {
    const host = hostOf(s.url);
    const excluded =
      !!host && ctx.excludeDomains.some((d) => host === d || host.endsWith("." + d));
    const echo = checkEcho && overlapRatio(ctx.text, s.content) > 0.3;
    if (excluded || echo) {
      ignored++;
      return false;
    }
    return true;
  });
  const sources = usable
    .sort((a, b) => domainTrust(b.url) - domainTrust(a.url))
    .slice(0, 6);

  if (sources.length === 0) {
    const v = noEvidenceVerdict(claim);
    return {
      claim, verdict: v, consensus: "unknown",
      explanation: explain(v, ""),
      evidence: [], sources: [], ignored,
    };
  }

  const sourceText = sources
    .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.content.slice(0, 1000)}`)
    .join("\n\n");
  const userMsg = `CLAIM: ${claim.text}\nCLAIM KIND: ${claim.kind}${
    claim.speaker ? ` (statement by ${claim.speaker})` : ""
  }\n\nSOURCES:\n${sourceText}`;

  const settled = await Promise.allSettled(
    Array.from({ length: STANCE_RUNS }, (_, k) =>
      askJson(SYSTEM, userMsg, {
        temperature: STANCE_RUNS > 1 ? 0.3 : 0,
        seed: 7 + k * 31,
        think: true,
      })
    )
  );
  const results = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  if (results.length === 0) throw new Error("Judge failed on all runs");

  const items = sources.map((src, idx) => {
    const votes: { stance: string; quote: string }[] = [];
    for (const r of results) {
      const rows: any[] = Array.isArray(r.sources) ? r.sources : [];
      const row = rows.find((x) => Number(x.i) === idx + 1);
      if (row) votes.push({ stance: String(row.stance), quote: String(row.quote ?? "") });
    }
    const stance = votes.length ? majority(votes.map((v) => v.stance), "neutral") : "neutral";
    const quote = votes.find((v) => v.stance === stance && v.quote)?.quote ?? "";
    return { src, stance, quote };
  });

  const raw = verdictFromStances(
    items.map((i) => ({ stance: i.stance, trust: domainTrust(i.src.url) }))
  );
  const verdict: Verdict = raw === "insufficient" ? noEvidenceVerdict(claim) : raw;

  const evidence: Evidence[] = items
    .filter(
      (i) =>
        ["supports", "contradicts", "partial"].includes(i.stance) &&
        i.quote &&
        norm(i.src.content).includes(norm(i.quote))
    )
    .slice(0, 3)
    .map((i) => ({ url: i.src.url, quote: i.quote, stance: i.stance }));

  console.log(
    `  [judge] ${claim.text.slice(0, 50)} -> ${verdict} | stances: ${items.map((i) => i.stance).join(", ")}`
  );
  console.log("  [sources]", sources.map((s) => s.title.slice(0, 45)).join(" | "));

  return {
    claim, verdict,
    consensus: majority(results.map((r) => String(r.consensus ?? "unknown")), "unknown"),
    explanation: explain(verdict, String(results[0].explanation ?? "")),
    evidence, sources, ignored,
  };
}

export function truthfulnessScore(judgments: Judgment[]): number | null {
  let weighted = 0;
  let totalWeight = 0;
  for (const j of judgments) {
    const points = POINTS[j.verdict];
    if (points === null || points === undefined) continue;
    // A confirmed "did they say it" claim proves little, so it is not counted
    if (j.claim.kind === "attribution" && points >= 50) continue;
    const w = claimWeight(j.claim);
    weighted += w * points;
    totalWeight += w;
  }
  return totalWeight === 0 ? null : Math.round(weighted / totalWeight);
}