import fs from "fs";

async function main() {
  const text = fs.readFileSync(process.argv[2] ?? "sample.txt", "utf8");
  const keys = ["overall", "truthfulness", "nuance", "framing", "consistency", "risk"];
  const runs: any[] = [];
  for (let i = 1; i <= 5; i++) {
    const res = await fetch("http://localhost:3000/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, fresh: true }),
    });
    const d = (await res.json()) as any;
    runs.push(d.scores);
    console.log(`run ${i}: ` + keys.map((k) => `${k}=${d.scores[k]}`).join(" "));
  }
  console.log("\nSPREAD (max - min):");
  for (const k of keys) {
    const v = runs.map((r) => r[k]).filter((x) => x !== null);
    console.log(`  ${k}: ${v.length ? Math.max(...v) - Math.min(...v) : "n/a"}`);
  }
}
main().catch((e) => console.error(e));