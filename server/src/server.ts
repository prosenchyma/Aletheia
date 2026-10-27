import "dotenv/config";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import fs from "fs";
import { extractClaims } from "./extract";
import { judgeClaim, claimWeight } from "./judge";
import { analyzeTextVoted } from "./analysis";
import { computeScores } from "./scoring";
import { hostOf } from "./tavily";

const CACHE_FILE = "cache.json";
let cache: Record<string, any> = {};
try {
  if (fs.existsSync(CACHE_FILE)) cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
} catch {
  cache = {};
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));

app.post("/analyze", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (text.length < 20) return res.status(400).json({ error: "Text too short" });
  if (text.length > 5000) return res.status(400).json({ error: "Text too long" });

  // Sources from the same site as the text must not be used to confirm it
  const pageHost = hostOf(String(req.body?.pageUrl ?? ""));
  const textHosts = (text.match(/https?:\/\/[^\s)]+/g) ?? []).map((u) => hostOf(u));
  const excludeDomains = [...new Set([pageHost, ...textHosts].filter((h): h is string => !!h))];

  const key = crypto
    .createHash("sha256")
    .update(text.toLowerCase().replace(/\s+/g, " ") + "|" + (pageHost ?? ""))
    .digest("hex");
  if (!req.body?.fresh && cache[key]) return res.json({ ...cache[key], cached: true });

  try {
    const factPipeline = (async () => {
      const claims = await extractClaims(text);
      const facts = claims
        .filter((c) => c.type === "fact")
        .sort((a, b) => claimWeight(b) - claimWeight(a))
        .slice(0, 6);
      const settled = await Promise.allSettled(
        facts.map((c) => judgeClaim(c, { text, excludeDomains }))
      );
      const judgments = settled.flatMap((s) => {
        if (s.status === "fulfilled") return [s.value];
        console.error("Judge failed:", s.reason?.message);
        return [];
      });
      return { claims, facts, judgments };
    })();

    const analysisPipeline = analyzeTextVoted(text).catch((err) => {
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

    const payload = {
      claims: fp.claims,
      judgments: fp.judgments.map((j) => ({
        ...j,
        sources: j.sources.map((s) => ({ title: s.title, url: s.url })),
      })),
      failed: fp.facts.length - fp.judgments.length,
      findings: analysis?.findings ?? [],
      meta: analysis?.meta ?? null,
      scores,
      excludedDomains: excludeDomains,
    };
    cache[key] = payload;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
    res.json(payload);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));