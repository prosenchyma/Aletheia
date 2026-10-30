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

app.set("trust proxy", 1);

const hits = new Map<string, number[]>();
let dayStart = Date.now();
let dayCount = 0;
const PER_IP_PER_HOUR = Number(process.env.PER_IP_PER_HOUR ?? 20);
const DAILY_CAP = Number(process.env.DAILY_CAP ?? 500);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/analyze", (req, res, next) => {
  const now = Date.now();
  if (now - dayStart > 24 * 3600 * 1000) {
    dayStart = now;
    dayCount = 0;
  }
  const ip = req.ip ?? "unknown";
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600 * 1000);
  if (recent.length >= PER_IP_PER_HOUR || dayCount >= DAILY_CAP) {
    return res.status(429).json({ error: "Rate limit reached. Please try again later." });
  }
  recent.push(now);
  hits.set(ip, recent);
  dayCount++;
  next();
});

app.post("/analyze", async (req, res) => {
  const t0 = Date.now();
  const lap = (label: string) =>
  console.log(`[timing] ${label}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const text = String(req.body?.text ?? "").trim();
  if (text.length < 20) return res.status(400).json({ error: "Text too short" });
  if (text.length > 5000) return res.status(400).json({ error: "Text too long" });

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
      lap("claims extracted");
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
      console.log("[summary] claims:");
      claims.forEach((c) => console.log(`   ${c.kind}/${c.type}: ${c.text}  | query: ${c.query}`));
      console.log("[summary] verdicts:", judgments.map((j) => `${j.claim.kind}=${j.verdict}`).join(", "));
      lap("facts judged");
      return { claims, facts, judgments };
    })();

    const analysisPipeline = analyzeTextVoted(text)
      .then((r) => {
        lap("writing analysis done");
        return r;
      })
      .catch((err) => {
        console.error("Analysis failed:", err.message);
        return null;
      });

    const [fp, analysis] = await Promise.all([factPipeline, analysisPipeline]);
    lap("all done");

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