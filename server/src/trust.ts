const TRUSTED = [
  ".gov", ".edu", ".gov.uk", "europa.eu", "who.int", "un.org", "oecd.org",
  "worldbank.org", "scb.se", "ourworldindata.org", "pewresearch.org",
  "reuters.com", "apnews.com", "bbc.com", "bbc.co.uk",
  "britannica.com", "wikipedia.org", "nature.com", "science.org",
  "factcheck.org", "snopes.com", "politifact.com",
];

export function domainTrust(url: string): number {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const ok = TRUSTED.some((t) =>
      t.startsWith(".") ? host.endsWith(t) : host === t || host.endsWith("." + t)
    );
    return ok ? 1 : 0.5;
  } catch {
    return 0.5;
  }
}