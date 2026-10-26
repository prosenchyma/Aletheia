import { askJson } from "./llm";
import { searchWeb } from "./tavily";

const sampleText = `
The Great Wall of China is visible from space with the naked eye. 
Sweden has a population of about 10 million people. 
Vaccines cause autism, which is why every parent should avoid them. 
The Eiffel Tower was completed in 1889 and is the best landmark in Europe.
`;

const SYSTEM = `You split text into individual claims. Return ONLY JSON in this shape:
{"claims":[{"text":"...","type":"fact"|"opinion"|"prediction","centrality":1|2|3}]}

Rules:
1. Each claim must be one short, self-contained sentence that makes sense on its own.
2. SPLIT compound sentences. If a sentence contains several assertions, make each one a separate claim.
3. type="fact": ANY statement about how the world is or was that could in principle be checked, whether it is true OR false. A false or conspiratorial statement is still a fact claim. Example: "Vaccines cause autism" is a fact claim.
4. type="opinion": only subjective judgments, values, or recommendations ("the best", "should", "beautiful"). Example: "every parent should avoid vaccines" is an opinion/recommendation.
5. type="prediction": statements about the future.
6. If unsure whether something is a fact or an opinion, choose "fact" so that it gets checked.
7. centrality: 3 = core claim, 2 = supporting claim, 1 = minor detail.`;

async function main() {
  console.log("Extracting claims...\n");
  const result = await askJson(SYSTEM, sampleText);
  console.log(JSON.stringify(result, null, 2));

  const factClaims = result.claims.filter((c: any) => c.type === "fact");
  for (const claim of factClaims) {
    console.log(`\nSearching evidence for: ${claim.text}`);
    const sources = await searchWeb(claim.text);
    for (const s of sources.slice(0, 3)) {
      console.log(`  - ${s.title}\n    ${s.url}`);
    }
  }
}

main().catch((err) => console.error("ERROR:", err.message));