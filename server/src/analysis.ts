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
  ratings: Record<Category, number>;
  agreement: number; 
};

const ABSENCE = new Set([
  "omission", "missing_caveats", "no_counter_perspective",
  "one_sided_voices", "missing_context_numbers",
]);

const CRITERIA_LIST = CATEGORIES.map((c) => `- ${c}: ${RUBRIC[c].join(", ")}`).join("\n");

const SYSTEM = `You analyze HOW a text is written, not whether its facts are true (another system checks the facts).

STEP 1. Rate each of the 6 categories from 0 to 4 for how much PROBLEMATIC writing the text shows:
0 = none: the text is clean in this respect
1 = mild: one minor instance
2 = moderate: one clear instance, or a few minor ones
3 = strong: several clear instances, or one that is central to the message
4 = extreme: it dominates the text, present in almost every sentence

Categories and what they cover:
${CRITERIA_LIST}

Calibration examples (different from the text you will analyze):
A) "The unemployment rate fell to 6.1% in March, according to the national statistics agency. Economists caution that the figure may be revised and that it excludes people who have stopped looking for work."
   -> nuance 0, logic 0, framing 0, emotion 0, consistency 0, manipulation 0
B) "The government's DISASTROUS new tax will destroy every family in this country. Only a fool would support it. Wake up before it is too late!"
   -> nuance 4, logic 2, framing 3, emotion 4, consistency 0, manipulation 2
C) "A leaked memo proves the mayor secretly takes orders from foreign agents. The mainstream media will never report this, so do your own research and ignore the so-called experts."
   -> nuance 2, logic 3, framing 2, emotion 1, consistency 0, manipulation 4

STEP 2. List up to 8 specific findings: the most important problems, each tied to one criterion from the lists above.

Return ONLY JSON in this shape:
{"ratings":{"nuance":0,"logic":0,"framing":0,"emotion":0,"consistency":0,"manipulation":0},
 "findings":[{"category":"nuance","criterion":"absolutism","severity":2,"quote":"...","explanation":"..."}],
 "meta":{"text_type":"news"|"opinion"|"social_post"|"scientific"|"other","opinion_share":0.0,"contested_topic":false,"dominant_emotion":"fear"|"anger"|"disgust"|"pride"|"pity"|"hope"|"none","overall_intent":"inform"|"persuade"|"manipulate"}}

Rules:
1. Rate each category on the whole text, independently, using the anchors and examples. Be consistent: the same text must get the same ratings every time.
2. A neutral, balanced, well-sourced text gets 0 everywhere. Rate only what is visible in the text. Do not speculate about hidden intentions.
3. A category rated 1 or more needs at least one finding. A category rated 0 has none.
4. severity: 1 = mild, 2 = clear, 3 = severe.
5. quote: ONE continuous passage copied exactly from the text, at most 15 words, no ellipses. It may be empty only for: omission, missing_caveats, no_counter_perspective, one_sided_voices, missing_context_numbers.
6. explanation: one short sentence.
7. contested_topic is true only if reasonable people disagree on values (politics, religion, ethics), not for settled facts.
8. For texts under 40 words, do not rate omissions or missing caveats.
9. Inside strings never use double quote characters (use single quotes) and never use line breaks.`;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

// Lenient check: most of the quote's words must appear in the text
function quoteInText(quote: string, haystackWords: Set<string>): boolean {
  const w = norm(quote).split(" ").filter(Boolean);
  if (w.length < 2) return false;
  const hit = w.filter((x) => haystackWords.has(x)).length;
  return hit / w.length >= 0.8;
}

function mode(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

type Run = { ratings: Record<Category, number>; findings: Finding[]; meta: Meta };

async function runOnce(text: string, seed: number): Promise<Run> {
  const result = await askJson(SYSTEM, `TEXT:\n${text}`, { temperature: 0.2, seed });

  // Every category must be present, otherwise this run is thrown away
  const ratings = {} as Record<Category, number>;
  for (const c of CATEGORIES) {
    const v = Number(result.ratings?.[c]);
    if (!Number.isFinite(v)) throw new Error(`Run is missing a rating for ${c}`);
    ratings[c] = Math.min(4, Math.max(0, Math.round(v)));
  }
  console.log("  [analysis] ratings:", JSON.stringify(ratings));

  const words = new Set(norm(text).split(" ").filter(Boolean));
  const findings: Finding[] = [];
  for (const f of Array.isArray(result.findings) ? result.findings : []) {
    const category = f.category as Category;
    const criterion = String(f.criterion ?? "");
    if (!CATEGORIES.includes(category)) continue;
    if (!(RUBRIC[category] as readonly string[]).includes(criterion)) continue;
    const quote = String(f.quote ?? "");
    if (!ABSENCE.has(criterion) && !quoteInText(quote, words)) continue;
    findings.push({
      category, criterion,
      severity: Math.min(3, Math.max(1, Math.round(Number(f.severity) || 1))) as 1 | 2 | 3,
      quote,
      explanation: String(f.explanation ?? ""),
    });
  }

  const m = result.meta ?? {};
  const meta: Meta = {
    text_type: String(m.text_type ?? "other"),
    opinion_share: Math.min(1, Math.max(0, Number(m.opinion_share) || 0)),
    contested_topic: Boolean(m.contested_topic),
    dominant_emotion: String(m.dominant_emotion ?? "none"),
    overall_intent: String(m.overall_intent ?? "inform"),
  };
  return { ratings, findings, meta };
}

export async function analyzeTextVoted(text: string, runs = 5): Promise<AnalysisResult> {
  const settled = await Promise.allSettled(
    Array.from({ length: runs }, (_, i) => runOnce(text, 101 + i * 17))
  );
  const ok = settled.flatMap((s) => {
    if (s.status === "fulfilled") return [s.value];
    console.warn("  [analysis] run discarded:", s.reason?.message);
    return [];
  });
  if (ok.length === 0) throw new Error("All analysis runs failed");

  const trimmedMean = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    const t = s.length >= 5 ? s.slice(1, -1) : s;
    return t.reduce((a, b) => a + b, 0) / t.length;
  };
  const ratings = {} as Record<Category, number>;
  let spread = 0;
  for (const c of CATEGORIES) {
    const v = ok.map((r) => r.ratings[c]);
    ratings[c] = trimmedMean(v);
    spread += Math.max(...v) - Math.min(...v);
  }
  const agreement = 1 - spread / (CATEGORIES.length * 4);

  const byCrit = new Map<string, { f: Finding; runs: number }>();
  for (const r of ok) {
    const seen = new Set<string>();
    for (const f of r.findings) {
      if (seen.has(f.criterion)) continue;
      seen.add(f.criterion);
      const cur = byCrit.get(f.criterion);
      if (!cur) byCrit.set(f.criterion, { f, runs: 1 });
      else {
        cur.runs++;
        if (f.severity > cur.f.severity) cur.f = f;
      }
    }
  }
  const need = ok.length >= 3 ? Math.ceil(ok.length / 2) : 1;
  const findings = [...byCrit.values()]
    .filter((x) => (x.runs >= need || x.f.severity === 3) && ratings[x.f.category] >= 0.5)
    .map((x) => x.f)
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 8);

  const metas = ok.map((r) => r.meta);
  const meta: Meta = {
    text_type: mode(metas.map((m) => m.text_type)),
    opinion_share:
      Math.round((metas.reduce((a, m) => a + m.opinion_share, 0) / metas.length) * 100) / 100,
    contested_topic: metas.filter((m) => m.contested_topic).length > metas.length / 2,
    dominant_emotion: mode(metas.map((m) => m.dominant_emotion)),
    overall_intent: mode(metas.map((m) => m.overall_intent)),
  };

  return { findings, meta, ratings, agreement };
}