import { askJson } from "./llm";

export type Claim = {
  text: string;
  type: "fact" | "opinion" | "prediction";
  centrality: 1 | 2 | 3;
};

const SYSTEM = `You split text into individual claims. Return ONLY JSON in this shape:
{"claims":[{"text":"...","type":"fact"|"opinion"|"prediction","centrality":1|2|3}]}

Rules:
1. Each claim must be one short, self-contained sentence that makes sense on its own.
2. SPLIT compound sentences. If a sentence contains several assertions, make each one a separate claim.
3. type="fact": ANY statement about how the world is or was that could in principle be checked, whether it is true OR false. A false or conspiratorial statement is still a fact claim.
4. type="opinion": only subjective judgments, values, or recommendations ("the best", "should", "beautiful").
5. type="prediction": statements about the future.
6. If unsure whether something is a fact or an opinion, choose "fact" so that it gets checked.
7. centrality: 3 = core claim, 2 = supporting claim, 1 = minor detail.`;

export async function extractClaims(text: string): Promise<Claim[]> {
  const result = await askJson(SYSTEM, text);
  return result.claims;
}