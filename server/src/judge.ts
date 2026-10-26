import { askJson } from "./llm";
import { searchWeb, Source } from "./tavily";
import { Claim } from "./extract";

export type Verdict =
  | "supported"
  | "mostly_supported"
  | "mixed"
  | "mostly_contradicted"
  | "contradicted"
  | "insufficient";

export type Judgment = {
  claim: Claim;
  verdict: Verdict;
  explanation: string;
  evidence: { url: string; quote: string }[];
  sources: Source[];
};

export const POINTS: Record<Verdict, number | null> = {
  supported: 100,
  mostly_supported: 80,
  mixed: 50,
  mostly_contradicted: 20,
  contradicted: 0,
  insufficient: null,
};

const SYSTEM = `You are a careful fact-checker. You receive ONE claim and several web sources.
Judge the claim ONLY from the sources provided. Do not use your own memory of the facts.
Return ONLY JSON in this shape:
{"verdict":"supported"|"mostly_supported"|"mixed"|"mostly_contradicted"|"contradicted"|"insufficient",
 "explanation":"1-2 sentences",
 "evidence":[{"url":"...","quote":"..."}]}

Verdict meanings:
- supported: sources clearly confirm the claim.
- mostly_supported: confirmed with minor inaccuracies or imprecision.
- mixed: partly true, or true but misleading without context, or sources disagree.
- mostly_contradicted: sources mostly show the claim is wrong.
- contradicted: sources clearly show the claim is false.
- insufficient: the sources do not contain enough information. Use this rather than guessing.

Rules for evidence: each quote must be copied exactly from the source text and be under 25 words.
Give at most 2 evidence items. Prefer reliable sources (research, government, encyclopedias, established media).
JSON formatting: inside any string value, never use double quote characters (use single quotes instead) and never use line breaks.`;

export async function judgeClaim(claim: Claim): Promise<Judgment> {
  const sources = await searchWeb(claim.text);
  const sourceText = sources
    .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.content.slice(0, 1500)}`)
    .join("\n\n");

  const result = await askJson(
    SYSTEM,
    `CLAIM: ${claim.text}\n\nSOURCES:\n${sourceText}`
  );

  return {
    claim,
    verdict: result.verdict,
    explanation: result.explanation,
    evidence: result.evidence ?? [],
    sources,
  };
}

export function truthfulnessScore(judgments: Judgment[]): number | null {
  let weighted = 0;
  let totalWeight = 0;
  for (const j of judgments) {
    const points = POINTS[j.verdict];
    if (points === null || points === undefined) continue;
    weighted += j.claim.centrality * points;
    totalWeight += j.claim.centrality;
  }
  return totalWeight === 0 ? null : Math.round(weighted / totalWeight);
}