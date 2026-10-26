import "dotenv/config";

export type Source = { title: string; url: string; content: string };

export async function searchWeb(query: string): Promise<Source[]> {
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
      exclude_domains: [
        "instagram.com", "facebook.com", "tiktok.com", "x.com",
        "twitter.com", "reddit.com", "pinterest.com", "youtube.com",
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Tavily error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as any;
  return data.results.map((r: any) => ({
    title: r.title,
    url: r.url,
    content: r.content,
  }));
}