import { extractClaims } from "./extract";
import { judgeClaim, truthfulnessScore } from "./judge";

const sampleText = `
The Great Wall of China is visible from space with the naked eye. 
Sweden has a population of about 10 million people. 
Vaccines cause autism, which is why every parent should avoid them. 
The Eiffel Tower was completed in 1889 and is the best landmark in Europe.
`;

async function main() {
  const start = Date.now();

  const claims = await extractClaims(sampleText);
  const factClaims = claims.filter((c) => c.type === "fact");
  console.log(`Found ${claims.length} claims, checking ${factClaims.length} facts...\n`);

  // All claims are checked at the same time (in parallel)
  const settled = await Promise.allSettled(factClaims.map(judgeClaim));
  const judgments = settled.flatMap((s, i) => {
  if (s.status === "fulfilled") return [s.value];
  console.log(`FAILED to judge: ${factClaims[i].text}\n  ${s.reason}\n`);
  return [];
  });

  for (const j of judgments) {
    console.log(`CLAIM: ${j.claim.text}`);
    console.log(`  Verdict: ${j.verdict}`);
    console.log(`  Weight: ${j.claim.centrality}`);
    console.log(`  Why: ${j.explanation}`);
    for (const e of j.evidence) {
      console.log(`  Evidence: "${e.quote}"\n    ${e.url}`);
    }
    console.log();
  }

  console.log(`TRUTHFULNESS SCORE: ${truthfulnessScore(judgments)} / 100`);
  console.log(`Time: ${((Date.now() - start) / 1000).toFixed(1)} s`);
}

main().catch((err) => console.error("ERROR:", err.message));