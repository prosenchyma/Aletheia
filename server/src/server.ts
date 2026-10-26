import "dotenv/config";
import express from "express";
import cors from "cors";
import { extractClaims } from "./extract";
import { judgeClaim } from "./judge";
import { analyzeText } from "./analysis";
import { computeScores } from "./scoring";

const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));

app.post("/analyze", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (text.length < 20) return res.status(400).json({ error: "Text too short" });
  if (text.length > 5000) return res.status(400).json({ error: "Text too long" });

  try {
    // Part A: extract claims, search, judge. Part B: analyze the writing. Both at once.
    const factPipeline = (async () => {
      const claims = await extractClaims(text);
      const facts = claims.filter((c) => c.type === "fact").slice(0, 8);
      const settled = await Promise.allSettled(facts.map(judgeClaim));
      const judgments = settled.flatMap((s) =>
        s.status === "fulfilled" ? [s.value] : []
      );
      return { claims, facts, judgments };
    })();

    const analysisPipeline = analyzeText(text).catch((err) => {
      console.error("Analysis failed:", err.message);
      return null;
    });

    const [fp, analysis] = await Promise.all([factPipeline, analysisPipeline]);

    const scores = computeScores({
      text,
      judgments: fp.judgments,
      factCount: fp.facts.length,
      analysis,
    });

    res.json({
      claims: fp.claims,
      judgments: fp.judgments.map((j) => ({
        ...j,
        sources: j.sources.map((s) => ({ title: s.title, url: s.url })),
      })),
      failed: fp.facts.length - fp.judgments.length,
      findings: analysis?.findings ?? [],
      meta: analysis?.meta ?? null,
      scores,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));