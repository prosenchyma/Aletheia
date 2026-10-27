const TEXTS: Record<string, string> = {
  neutral:
    "Water boils at 100 degrees Celsius at sea level, although the exact temperature depends on air pressure. Stockholm is the capital of Sweden. The Eiffel Tower is located in Paris and was completed in 1889.",
  slanted_but_true:
    "SHOCKING! The corrupt elites have finally been forced to admit that Stockholm is the capital of Sweden, something THEY never wanted you to know. Wake up, people! They think you are too stupid to notice. Share this before it gets deleted!",
  false_viral:
    "Scientists have PROVEN that vaccines cause autism and the government is hiding it. Everyone knows 5G towers spread viruses. Always trust natural remedies and never trust doctors, they are all paid by Big Pharma.",
};

async function main() {
  for (const [name, text] of Object.entries(TEXTS)) {
    const t0 = Date.now();
    const res = await fetch("http://localhost:3000/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, fresh: true }),
    });
    const d = (await res.json()) as any;
    const s = d.scores;
    console.log(
      `${name.padEnd(18)} overall=${s.overall} truth=${s.truthfulness} nuance=${s.nuance} framing=${s.framing} consistency=${s.consistency} safety=${s.risk} confidence=${s.confidence} (${((Date.now() - t0) / 1000).toFixed(1)} s)`
    );
  }
}
main().catch((e) => console.error(e));