import { AnalysisResult, Category } from "./analysis";
import { Judgment, truthfulnessScore } from "./judge";
import { domainTrust } from "./trust";

const GROUPS: Record<"nuance" | "framing" | "consistency" | "risk", Category[]> = {
  nuance: ["nuance", "logic"],
  framing: ["framing", "emotion"],
  consistency: ["consistency"],
  risk: ["manipulation"],
};

function toScore(rating: number): number {
  return Math.max(0, 100 - 22.5 * rating);
}

function groupScore(ratings: Record<string, number>, cats: Category[]): number {
  const v = cats.map((c) => ratings[c] ?? 0).sort((a, b) => b - a);
  const eff = v.length === 1 ? v[0] : 0.6 * v[0] + 0.4 * v[1];
  return toScore(eff);
}

const round5 = (n: number | null): number | null =>
  n === null ? null : Math.round(n / 5) * 5;

export type Scores = {
  overall: number | null;
  truthfulness: number | null;
  nuance: number | null;
  framing: number | null;
  consistency: number | null;
  risk: number | null;
  confidence: number;
  confidenceLabel: "high" | "medium" | "low";
  coverage: number | null;
  note: string | null;
};

export function computeScores(input: {
  text: string;
  judgments: Judgment[];
  factCount: number;
  analysis: AnalysisResult | null;
}): Scores {
  const { text, judgments, factCount, analysis } = input;
  const words = text.split(/\s+/).filter(Boolean).length;

  const truthfulness = truthfulnessScore(judgments);
  const gs = (g: keyof typeof GROUPS) =>
    analysis ? groupScore(analysis.ratings, GROUPS[g]) : null;
  const nuance = gs("nuance");
  const framing = gs("framing");
  const consistency = gs("consistency");
  const risk = gs("risk");

  const checked = judgments.filter(
    (j) => j.verdict !== "insufficient" && j.verdict !== "unsupported"
  ).length;
  const coverage = factCount === 0 ? null : checked / factCount;
  const urls = judgments.flatMap((j) => j.evidence.map((e) => e.url));
  const sourceQuality = urls.length
    ? urls.reduce((a, u) => a + domainTrust(u), 0) / urls.length
    : 0.5;
  let confidence = coverage === null ? 0.6 : 0.6 * coverage + 0.4 * sourceQuality;
  if (words < 40) confidence *= 0.7;
  confidence *= 0.8 + 0.2 * (analysis?.agreement ?? 1);

  const parts = [
    { s: truthfulness, w: 0.45 },
    { s: nuance, w: 0.2 },
    { s: framing, w: 0.2 },
    { s: risk, w: 0.15 },
  ].filter((p) => p.s !== null) as { s: number; w: number }[];

  let overall: number | null = null;
  let note: string | null = null;
  if (parts.length > 0) {
    const totalW = parts.reduce((a, p) => a + p.w, 0);
    const raw = parts.reduce((a, p) => a + p.s * p.w, 0) / totalW;
    overall = 50 + (raw - 50) * confidence;
    const penalty = consistency === null ? 0 : Math.max(0, 80 - consistency) * 0.4;
    overall = Math.max(0, overall - penalty);
    if (truthfulness !== null && truthfulness < 30) overall = Math.min(overall, 40);
  }
  if (truthfulness === null && factCount > 0) {
    note = "No factual claims could be verified, so the overall score reflects the writing only.";
  } else if (coverage !== null && coverage < 0.25) {
    note = `Only ${checked} of ${factCount} factual claims could be verified, so treat the scores with caution.`;
  } else if (
    truthfulness === null &&
    judgments.length > 0 &&
    judgments.every((j) => j.claim.kind === "attribution" || j.verdict === "insufficient")
  ) {
    note = "Only whether the quotes were really said could be checked. The statements themselves had no independent sources.";
  } else if (factCount === 0) {
    note = "No checkable factual claims found. Factual score not applicable.";
  } else if (analysis && analysis.meta.opinion_share > 0.7) {
    note = "Mostly opinion. Treat the factual score with care.";
  }
  if (analysis?.meta.contested_topic) {
    note =
      (note ? note + " " : "") +
      "Contested topic: reasonable people disagree on values here, so read the perspectives rather than relying on the score.";
  }

  const confidenceLabel = confidence >= 0.75 ? "high" : confidence >= 0.5 ? "medium" : "low";
  return {
    overall: round5(overall),
    truthfulness: round5(truthfulness),
    nuance: round5(nuance),
    framing: round5(framing),
    consistency: round5(consistency),
    risk: round5(risk),
    confidence: Math.round(confidence * 100) / 100,
    confidenceLabel,
    coverage,
    note,
  };
}