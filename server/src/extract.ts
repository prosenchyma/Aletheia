import { askJson } from "./llm";

export type Claim = {
  text: string;
  type: "fact" | "opinion" | "prediction";
  centrality: 1 | 2 | 3;
  kind: "direct" | "attribution" | "embedded";
  speaker?: string;
};

const SYSTEM = `You split text into individual claims. Return ONLY JSON in this shape:
{"claims":[{"text":"...","type":"fact"|"opinion"|"prediction","centrality":1|2|3,"kind":"direct"|"attribution"|"embedded","speaker":"name or empty string"}]}

Rules:
1. Each claim is one short, self-contained sentence that makes sense on its own.
2. SPLIT compound sentences into separate claims.
3. type="fact": ANY statement about how the world is or was that could in principle be checked, whether true OR false. False or conspiratorial statements are still facts.
4. type="opinion": only subjective judgments, values, or recommendations ("the best", "should").
5. type="prediction": statements about the future.
6. If unsure whether something is fact or opinion, choose "fact".
7. centrality: 3 = core claim, 2 = supporting, 1 = minor detail.
8. REPORTED SPEECH. When the text says that someone said something, or contains a quoted statement, output TWO claims:
   a) kind="attribution": "X said that Y" (checkable: did X say it?), with speaker=X.
   b) kind="embedded": the statement Y itself as a stand-alone claim, with speaker=X. It is judged on its own merits, whether or not X said it.
   Everything else is kind="direct" with an empty speaker.
9. NEVER weaken, soften or rephrase a claim to make it more accurate or easier to confirm. Keep quantifiers exactly as written ("all", "every", "most", "always", "never", and unqualified statements about whole groups).
10. A statement that attributes a trait or behavior to a whole group of people (nationality, religion, ethnicity, profession, etc.) is a fact claim, never an opinion.
11. Output at most 10 claims. Skip trivial ones.
12. Inside strings never use double quote characters (use single quotes) and never use line breaks.`;

export async function extractClaims(text: string): Promise<Claim[]> {
  const result = await askJson(SYSTEM, text);
  return (result.claims ?? []).map((c: any) => ({
    text: String(c.text),
    type: ["fact", "opinion", "prediction"].includes(c.type) ? c.type : "fact",
    centrality: [1, 2, 3].includes(Number(c.centrality)) ? Number(c.centrality) : 2,
    kind: ["direct", "attribution", "embedded"].includes(c.kind) ? c.kind : "direct",
    speaker: c.speaker ? String(c.speaker) : undefined,
  }));
}