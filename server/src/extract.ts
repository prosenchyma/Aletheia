import { askJson } from "./llm";

export type Claim = {
  text: string;
  type: "fact" | "opinion" | "prediction";
  centrality: 1 | 2 | 3;
  kind: "direct" | "attribution" | "embedded";
  speaker?: string;
  query?: string;
  query_en?: string;
  absolute?: boolean;
};

const SYSTEM = `You split text into individual claims. Return ONLY JSON in this shape:
{"claims":[{"text":"...","query":"...","query_en":"...","absolute":false,"type":"fact"|"opinion"|"prediction","centrality":1|2|3,"kind":"direct"|"attribution"|"embedded","speaker":"name or empty string"}]}

Rules:
1. Each claim is one short sentence.
2. SPLIT compound sentences into separate claims.
3. type="fact": ANY statement about how the world is or was that could in principle be checked, whether true OR false. False or conspiratorial statements are still facts.
4. type="opinion": ONLY statements the author explicitly marks as a personal view ("I think", "I believe", "in my opinion", "to me", "personally", "jag tycker", "enligt mig"), and recommendations ("should", "ought to"). A flat statement with no such marker ("The Eiffel Tower is the best landmark in Europe") is NOT an opinion: it is a fact claim.
5. type="prediction": statements about the future, including promises ("I will build a wall").
6. If unsure whether something is fact or opinion, choose "fact".
7. centrality: 3 = core claim, 2 = supporting, 1 = minor detail.
8. REPORTED SPEECH. When the text says that someone said something, or contains a quoted statement, output TWO claims:
   a) kind="attribution": "X said that Y" (checkable: did X say it?), with speaker=X.
   b) kind="embedded": the statement Y itself as a stand-alone claim, with speaker=X. It is judged on its own merits, whether or not X said it.
   Everything else is kind="direct" with an empty speaker.
9. NEVER weaken, soften or rephrase a claim to make it more accurate or easier to confirm. Keep quantifiers exactly as written ("all", "every", "most", "always", "never", and unqualified statements about whole groups).
10. A statement that attributes a trait or behavior to a whole group of people (nationality, religion, ethnicity, profession, etc.) is a fact claim, never an opinion.
11. Output at most 10 claims. Skip trivial ones.
12. SELF-CONTAINED CLAIMS. Each claim will be searched on the web on its own, without the rest of the text. Replace every pronoun and vague reference (I, me, he, him, she, they, we, our, this, that, the president, the company) with the actual name, using the TEXT and the PAGE TITLE/URL given. A first-person statement inside a quote is rewritten about the speaker in the third person. Only use names that appear in the text or the page context. Never guess a name and never add outside knowledge. If a statement cannot be made self-contained this way, leave it out.
13. query: for every claim, a web search query of at most 12 words containing the key names, places, numbers and dates. No pronouns, no quotation marks.
13b. query_en: the same search query in English. If the text is already in English, copy query exactly. Keep names and technical terms unchanged.
13c. absolute: true for flat universal or superlative claims about quality, ability, achievement or comparison that carry NO personal-view marker ("nobody builds better than me", "the strongest ever", "faster than any human", "the best landmark in Europe", "no one has ever done X"). Otherwise false. These are type="fact". Example: "Usain Bolt is the fastest human" is a fact claim with absolute=true. If the same sentence starts with "I think", it is an opinion with absolute=false.
14. Inside strings never use double quote characters (use single quotes) and never use line breaks.`;

export async function extractClaims(
  text: string,
  ctx: { pageTitle?: string; pageUrl?: string } = {}
): Promise<Claim[]> {
  const context = [
    ctx.pageTitle ? `PAGE TITLE: ${ctx.pageTitle}` : "",
    ctx.pageUrl ? `PAGE URL: ${ctx.pageUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await askJson(SYSTEM, `${context ? context + "\n\n" : ""}TEXT:\n${text}`);
  return (result.claims ?? []).map((c: any) => ({
    text: String(c.text),
    type: ["fact", "opinion", "prediction"].includes(c.type) ? c.type : "fact",
    centrality: [1, 2, 3].includes(Number(c.centrality)) ? Number(c.centrality) : 2,
    kind: ["direct", "attribution", "embedded"].includes(c.kind) ? c.kind : "direct",
    speaker: c.speaker ? String(c.speaker) : undefined,
    query: c.query ? String(c.query).trim() : undefined,
    query_en: c.query_en ? String(c.query_en).trim() : undefined,
    absolute: Boolean(c.absolute),
  }));
}