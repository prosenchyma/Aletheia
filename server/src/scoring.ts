import { Finding, Meta, Category } from "./analysis";
import { Judgment, truthfulnessScore } from "./judge";
import { domainTrust } from "./trust";

// Some criteria hurt more than others
const MULT: Record<string, number> = {
  logical_contradiction: 2,
  numbers_dont_add_up: 2,
  conclusion_vs_data: 1.5,
};

const GROUPS: Record<"nuance" | "framing" | "consistency" | "risk", Category[]> = {
  nuance: ["nuance", "logic"],
  framing: ["framing", "emotion"],
  consistency: ["consistency"],
  risk: ["manipulation"],
};





// 0 findings -> 100. More and more severe findings -> lower, never below 0.
function penaltyScore(findings: Finding[], words: number, cats: Category[]): number {
  const sum = findings
    .filter((f) => cats.includes(f.category))
    .reduce((a, f) => a + f.severity * (MULT[f.criterion] ?? 1), 0);
  const density = sum / (Math.max(words, 60) / 100);
  return Math.round(100 * Math.exp(-density / 5));
}

export type Scores = {
  overall: number | null;
  truthfulness: number | null;
  nuance: number | null;
  framing: number | null;
  consistency: number | null;
  risk: number | null; // higher = safer
  confidence: number; // 0 to 1
  confidenceLabel: "high" | "medium" | "low";
  coverage: number | null;
  note: string | null;
};

export function computeScores(input: {
  text: string;
  judgments: Judgment[];
  factCount: number;
  analysis: { findings: Finding[]; meta: Meta } | null;
}): Scores {
  const { text, judgments, factCount, analysis } = input;
  const words = text.split(/\s+/).filter(Boolean).length;

  const truthfulness = truthfulnessScore(judgments);

  const pen = (g: keyof typeof GROUPS) =>
    analysis ? penaltyScore(analysis.findings, words, GROUPS[g]) : null;
  const nuance = pen("nuance");
  const framing = pen("framing");
  const consistency = pen("consistency");
  const risk = pen("risk");

  // Confidence: how much of the text could we actually check, and with what sources?
  const checked = judgments.filter((j) => j.verdict !== "insufficient").length;
  const coverage = factCount === 0 ? null : checked / factCount;
  const urls = judgments.flatMap((j) => j.evidence.map((e) => e.url));
  const sourceQuality = urls.length
    ? urls.reduce((a, u) => a + domainTrust(u), 0) / urls.length
    : 0.5;
  let confidence = coverage === null ? 0.6 : 0.6 * coverage + 0.4 * sourceQuality;
  if (words < 40) confidence *= 0.7;
        confidence *= 0.8 + 0.2 * ((analysis as any)?.agreement ?? 1);

  // Overall: weighted average of the gauges we have, shrunk toward 50 when unsure
  const parts = [
    { s: truthfulness, w: 0.4 },
    { s: consistency, w: 0.2 },
    { s: nuance, w: 0.15 },
    { s: framing, w: 0.15 },
    { s: risk, w: 0.1 },
  ].filter((p) => p.s !== null) as { s: number; w: number }[];

  let overall: number | null = null;
  let note: string | null = null;
  if (parts.length > 0) {
    const totalW = parts.reduce((a, p) => a + p.w, 0);
    const raw = parts.reduce((a, p) => a + p.s * p.w, 0) / totalW;
    overall = Math.round(50 + (raw - 50) * confidence);
    if (truthfulness !== null && truthfulness < 30) overall = Math.min(overall, 40);
  }
  if (coverage !== null && coverage < 0.25) {
    overall = null;
    note = "Insufficient evidence found to give an overall score.";
  } else if (factCount === 0) {
    note = "No checkable factual claims found. Factual score not applicable.";
  } else if (analysis && analysis.meta.opinion_share > 0.7) {
    note = "Mostly opinion. Treat the factual score with care.";
  }
  if (analysis?.meta.contested_topic) {
    note = (note ? note + " " : "") +
      "Contested topic: reasonable people disagree on values here, so read the perspectives rather than relying on the score.";
  }

  const confidenceLabel = confidence >= 0.75 ? "high" : confidence >= 0.5 ? "medium" : "low";

  return {
    overall, truthfulness, nuance, framing, consistency, risk,
    confidence: Math.round(confidence * 100) / 100,
    confidenceLabel, coverage, note,
  };
}