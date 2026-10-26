import "dotenv/config";
import express from "express";
import cors from "cors";
import { extractClaims } from "./extract";
import { judgeClaim, truthfulnessScore } from "./judge";

const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));

app.post("/analyze", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (text.length < 20) return res.status(400).json({ error: "Text too short" });
  if (text.length > 5000) return res.status(400).json({ error: "Text too long" });

  try {
    const claims = await extractClaims(text);
    const facts = claims.filter((c) => c.type === "fact").slice(0, 8);
    const settled = await Promise.allSettled(facts.map(judgeClaim));
    const judgments = settled.flatMap((s) =>
      s.status === "fulfilled" ? [s.value] : []
    );
    const slim = judgments.map((j) => ({
      ...j,
      sources: j.sources.map((s) => ({ title: s.title, url: s.url })),
    }));
    res.json({
      claims,
      judgments: slim,
      failed: facts.length - judgments.length,
      truthfulness: truthfulnessScore(judgments),
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));