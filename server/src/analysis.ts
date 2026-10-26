import { askJson } from "./llm";

export const CATEGORIES = [
  "nuance", "logic", "framing", "emotion", "consistency", "manipulation",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type Finding = {
  category: Category;
  criterion: string;
  severity: 1 | 2 | 3;
  quote: string;
  explanation: string;
};

export type Meta = {
  text_type: string;
  opinion_share: number; // 0 to 1
  contested_topic: boolean;
  dominant_emotion: string;
  overall_intent: string;
};

const SYSTEM = `You analyze HOW a text is written: its nuance, logic, framing, emotional language, internal consistency and manipulation signals. You do NOT judge whether facts are true; another system does that.
Return ONLY JSON in this shape:
{"findings":[{"category":"...","criterion":"...","severity":1,"quote":"...","explanation":"..."}],
 "meta":{"text_type":"news"|"opinion"|"social_post"|"scientific"|"other","opinion_share":0.0,"contested_topic":false,"dominant_emotion":"fear"|"anger"|"disgust"|"pride"|"pity"|"hope"|"none","overall_intent":"inform"|"persuade"|"manipulate"}}

Allowed categories and criteria:
- nuance: absolutism, oversimplification, missing_caveats, no_counter_perspective, correlation_vs_causation, exaggerated_proportions, overgeneralization, overconfident_wording
- logic: fallacy (name the fallacy in the explanation), unsound_inference, unproven_assumption, burden_of_proof_shift, anecdotal_evidence, irrelevant_authority
- framing: loaded_words, euphemism_or_dysphemism, uneven_description, hidden_responsibility, omission, cherry_picking, missing_context_numbers, one_sided_voices, misleading_headline, conflict_frame
- emotion: emotional_charge, sensationalism, appeal_to_fear, appeal_to_pity, appeal_to_identity, personal_attack, us_vs_them, false_urgency
- consistency: logical_contradiction, numbers_dont_add_up, timeline_error, shifting_definition, headline_vs_body, conclusion_vs_data, shifting_stance, tone_vs_facts, claimed_neutrality_vs_loaded_language, shifting_emotional_tone
- manipulation: anonymous_source, conspiracy_pattern, unfalsifiable_claim, distrust_of_established_sources, known_disinformation_narrative, mass_produced_style

Severity: 1 = minor or mild, 2 = clear and noticeable, 3 = severe or central to the message of the text.

Rules:
1. "quote" must be copied exactly from the text, at most 15 words. For omission, missing_caveats, no_counter_perspective, one_sided_voices and missing_context_numbers the quote may be an empty string.
2. Only report real problems clearly visible in the text. A neutral, balanced text must return an empty findings list. Never invent findings.
3. At most 12 findings: the most important ones. One finding per issue.
4. "explanation" is one short sentence.
5. Inside strings never use double quote characters (use single quotes) and never use line breaks.
6. contested_topic is true only if reasonable people disagree on values (politics, religion, ethics), not for settled facts.
7. For texts under 40 words, report only clear issues.`;

const ABSENCE = new Set([
  "omission", "missing_caveats", "no_counter_perspective",
  "one_sided_voices", "missing_context_numbers",
]);

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function analyzeText(
  text: string
): Promise<{ findings: Finding[]; meta: Meta }> {
  const result = await askJson(SYSTEM, `TEXT:\n${text}`);
  const haystack = norm(text);

  const findings: Finding[] = (result.findings ?? [])
    .filter((f: any) => CATEGORIES.includes(f.category))
    .map((f: any) => ({
      category: f.category,
      criterion: String(f.criterion ?? ""),
      severity: Math.min(3, Math.max(1, Math.round(Number(f.severity) || 1))),
      quote: String(f.quote ?? ""),
      explanation: String(f.explanation ?? ""),
    }))
    // Throw away findings whose quote is not actually in the text
    .filter(
      (f: Finding) =>
        ABSENCE.has(f.criterion) ||
        (f.quote.length > 0 && haystack.includes(norm(f.quote)))
    );

  const m = result.meta ?? {};
  const meta: Meta = {
    text_type: String(m.text_type ?? "other"),
    opinion_share: Math.min(1, Math.max(0, Number(m.opinion_share) || 0)),
    contested_topic: Boolean(m.contested_topic),
    dominant_emotion: String(m.dominant_emotion ?? "none"),
    overall_intent: String(m.overall_intent ?? "inform"),
  };

  return { findings, meta };
}