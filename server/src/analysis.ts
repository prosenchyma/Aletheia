import { askJson } from "./llm";

export const RUBRIC = {
  nuance: [
    "absolutism", "oversimplification", "missing_caveats", "no_counter_perspective",
    "correlation_vs_causation", "exaggerated_proportions", "overgeneralization",
    "overconfident_wording",
  ],
  logic: [
    "fallacy", "unsound_inference", "unproven_assumption", "burden_of_proof_shift",
    "anecdotal_evidence", "irrelevant_authority",
  ],
  framing: [
    "loaded_words", "euphemism_or_dysphemism", "uneven_description", "hidden_responsibility",
    "omission", "cherry_picking", "missing_context_numbers", "one_sided_voices",
    "misleading_headline", "conflict_frame",
  ],
  emotion: [
    "emotional_charge", "sensationalism", "appeal_to_fear", "appeal_to_pity",
    "appeal_to_identity", "personal_attack", "us_vs_them", "false_urgency",
  ],
  consistency: [
    "logical_contradiction", "numbers_dont_add_up", "timeline_error", "shifting_definition",
    "headline_vs_body", "conclusion_vs_data", "shifting_stance", "tone_vs_facts",
    "claimed_neutrality_vs_loaded_language", "shifting_emotional_tone",
  ],
  manipulation: [
    "anonymous_source", "conspiracy_pattern", "unfalsifiable_claim",
    "distrust_of_established_sources", "known_disinformation_narrative", "mass_produced_style",
  ],
} as const;

export type Category = keyof typeof RUBRIC;
export const CATEGORIES = Object.keys(RUBRIC) as Category[];

export type Finding = {
  category: Category;
  criterion: string;
  severity: 1 | 2 | 3;
  quote: string;
  explanation: string;
};

export type Meta = {
  text_type: string;
  opinion_share: number;
  contested_topic: boolean;
  dominant_emotion: string;
  overall_intent: string;
};

export type AnalysisResult = {
  findings: Finding[];
  meta: Meta;
  ratings: Record<string, number>;
  agreement: number; // 0 to 1: how much the 3 runs agreed
};

const ALL: { category: Category; criterion: string }[] = CATEGORIES.flatMap((c) =>
  RUBRIC[c].map((criterion) => ({ category: c, criterion }))
);

const ABSENCE = new Set([
  "omission", "missing_caveats", "no_counter_perspective",
  "one_sided_voices", "missing_context_numbers",
]);

const CRITERIA_LIST = CATEGORIES.map((c) => `- ${c}: ${RUBRIC[c].join(", ")}`).join("\n");

const SYSTEM = `You analyze HOW a text is written: its nuance, logic, framing, emotional language, internal consistency and manipulation signals. You do NOT judge whether facts are true; another system does that.

Rate EVERY criterion below on this scale:
0 = not present
1 = mild: one minor instance
2 = clear: a noticeable instance, or several minor ones
3 = severe: repeated, or central to the message of the text

Criteria by category:
${CRITERIA_LIST}

Return ONLY JSON in this shape:
{"ratings":{"absolutism":0,"oversimplification":0,"...":0},
 "details":[{"criterion":"absolutism","quote":"...","explanation":"..."}],
 "meta":{"text_type":"news"|"opinion"|"social_post"|"scientific"|"other","opinion_share":0.0,"contested_topic":false,"dominant_emotion":"fear"|"anger"|"disgust"|"pride"|"pity"|"hope"|"none","overall_intent":"inform"|"persuade"|"manipulate"}}

Rules:
1. "ratings" must contain EVERY criterion listed above, each an integer from 0 to 3. Rate each criterion independently.
2. "details" must contain one entry for every criterion rated 1 or higher, and no others.
3. quote: ONE continuous passage copied exactly from the text, at most 15 words, no ellipses. It may be an empty string only for: omission, missing_caveats, no_counter_perspective, one_sided_voices, missing_context_numbers.
4. explanation: one short sentence.
5. Be calibrated and consistent. A neutral, balanced, well-sourced text must get 0 on everything. Rate only what is clearly visible in the text; do not speculate about intentions.
6. A text under 40 words cannot show omissions or missing caveats. Rate those 0 unless clearly relevant.
7. contested_topic is true only if reasonable people disagree on values (politics, religion, ethics), not for settled facts.
8. Inside strings never use double quote characters (use single quotes) and never use line breaks.`;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function mode(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

type Run = {
  ratings: Record<string, { r: number; quote: string; why: string }>;
  meta: Meta;
};

async function runOnce(text: string, seed: number): Promise<Run> {
  const result = await askJson(SYSTEM, `TEXT:\n${text}`, { temperature: 0.3, seed });
  const haystack = norm(text);

  const detail = new Map<string, any>();
  for (const d of Array.isArray(result.details) ? result.details : []) {
    detail.set(String(d.criterion), d);
  }

  const out: Run["ratings"] = {};
  for (const { criterion } of ALL) {
    let r = Math.min(3, Math.max(0, Math.round(Number(result.ratings?.[criterion]) || 0)));
    const d = detail.get(criterion);
    const quote = String(d?.quote ?? "");
    const why = String(d?.explanation ?? "");
    const nq = norm(quote);
    // A problem without a real quote from the text does not count
    if (r > 0 && !ABSENCE.has(criterion) && !(nq.length > 0 && haystack.includes(nq))) r = 0;
    out[criterion] = { r, quote, why };
  }

  const m = result.meta ?? {};
  const meta: Meta = {
    text_type: String(m.text_type ?? "other"),
    opinion_share: Math.min(1, Math.max(0, Number(m.opinion_share) || 0)),
    contested_topic: Boolean(m.contested_topic),
    dominant_emotion: String(m.dominant_emotion ?? "none"),
    overall_intent: String(m.overall_intent ?? "inform"),
  };
  return { ratings: out, meta };
}

export async function analyzeTextVoted(text: string, runs = 3): Promise<AnalysisResult> {
  const settled = await Promise.allSettled(
    Array.from({ length: runs }, (_, i) => runOnce(text, 101 + i * 17))
  );
  const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  if (ok.length === 0) throw new Error("All analysis runs failed");

  const ratings: Record<string, number> = {};
  const findings: Finding[] = [];
  let spreadSum = 0;
  let active = 0;

  for (const { category, criterion } of ALL) {
    const cells = ok.map((r) => r.ratings[criterion]);
    const vals = cells.map((c) => c.r);
    const med = median(vals);
    ratings[criterion] = med;
    if (Math.max(...vals) > 0) {
      active++;
      spreadSum += Math.max(...vals) - Math.min(...vals);
    }
    if (med > 0) {
      const src = cells.find((c) => c.r === med) ?? cells.find((c) => c.r > 0)!;
      findings.push({
        category, criterion,
        severity: med as 1 | 2 | 3,
        quote: src.quote, explanation: src.why,
      });
    }
  }

  const metas = ok.map((r) => r.meta);
  const meta: Meta = {
    text_type: mode(metas.map((m) => m.text_type)),
    opinion_share:
      Math.round((metas.reduce((a, m) => a + m.opinion_share, 0) / metas.length) * 100) / 100,
    contested_topic: metas.filter((m) => m.contested_topic).length > metas.length / 2,
    dominant_emotion: mode(metas.map((m) => m.dominant_emotion)),
    overall_intent: mode(metas.map((m) => m.overall_intent)),
  };

  const agreement = active === 0 ? 1 : 1 - spreadSum / (3 * active);
  return { findings, meta, ratings, agreement };
}