import "dotenv/config";
import fs from "fs";

export type Source = { title: string; url: string; content: string };

const BLOCKED = [
  "instagram.com", "facebook.com", "tiktok.com", "x.com",
  "twitter.com", "reddit.com", "pinterest.com", "youtube.com",
];

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

const SC_FILE = "search-cache.json";
const TTL = 24 * 3600 * 1000;
let sc: Record<string, { t: number; v: Source[] }> = {};
try {
  if (fs.existsSync(SC_FILE)) sc = JSON.parse(fs.readFileSync(SC_FILE, "utf8"));
} catch {
  sc = {};
}

async function tavilySearch(query: string, exclude: string[]): Promise<Source[]> {
  const key = query + "|" + exclude.join(",");
  const hit = sc[key];
  if (hit && Date.now() - hit.t < TTL) return hit.v;

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      max_results: 6,
      search_depth: "basic",
      exclude_domains: exclude,
    }),
  });
  if (!res.ok) throw new Error(`Tavily error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as any;
  const v: Source[] = data.results.map((r: any) => ({
    title: r.title,
    url: r.url,
    content: r.content,
  }));
  sc[key] = { t: Date.now(), v };
  fs.writeFileSync(SC_FILE, JSON.stringify(sc));
  return v;
}

export async function searchWeb(
  queries: string[],
  excludeDomains: string[] = []
): Promise<Source[]> {
  const exclude = [...BLOCKED, ...excludeDomains];
  const lists = await Promise.all(queries.map((q) => tavilySearch(q, exclude)));
  const seen = new Set<string>();
  const merged: Source[] = [];
  for (const list of lists) {
    for (const s of list) {
      if (!seen.has(s.url)) {
        seen.add(s.url);
        merged.push(s);
      }
    }
  }
  return merged;
}