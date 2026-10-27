const API = "http://localhost:3000/analyze";
const root = document.getElementById("root");

const VERDICTS = {
  supported: ["Supported", "good"],
  mostly_supported: ["Mostly supported", "good"],
  mixed: ["Mixed / missing context", "warn"],
  mostly_contradicted: ["Mostly contradicted", "bad"],
  contradicted: ["Contradicted", "bad"],
  insufficient: ["Not enough evidence", "neutral"],
};
const CATEGORY_LABELS = {
  nuance: "Nuance",
  logic: "Logic",
  framing: "Framing",
  emotion: "Emotional language",
  consistency: "Consistency",
  manipulation: "Manipulation signals",
};

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
const band = (n) => (n >= 70 ? "good" : n >= 40 ? "warn" : "bad");
const pretty = (s) => String(s).replace(/_/g, " ");

function gauge(name, value) {
  const row = el("div", "gauge");
  const head = el("div", "gauge-head");
  const word = value === null ? "" : value >= 70 ? " (good)" : value >= 40 ? " (mixed)" : " (poor)";
  head.append(el("span", "", name), el("span", "gauge-val", value === null ? "n/a" : value + word));
  const track = el("div", "bar");
  const fill = el("div", "fill " + (value === null ? "neutral" : band(value)));
  fill.style.width = (value === null ? 0 : value) + "%";
  track.append(fill);
  row.append(head, track);
  return row;
}

async function run(text, pageUrl) {
  root.replaceChildren(
    el("p", "status", "Checking claims and analyzing the writing... about 10-20 seconds."),
    el("blockquote", "quote", text)
  );
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, pageUrl }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
    render(text, data);
  } catch (e) {
    root.replaceChildren(el("p", "error", "Something went wrong: " + e.message));
  }
}

function render(text, data) {
  const s = data.scores;
  root.replaceChildren();
  root.append(el("blockquote", "quote", text));

  // Overall score
  const box = el("div", "score");
  box.append(
    el("div", "num", s.overall === null ? "N/A" : s.overall + " / 100"),
    el("div", "sub", "Overall estimate \u00B7 confidence: " + s.confidenceLabel)
  );
  root.append(box);
  if (s.note) root.append(el("p", "note", s.note));

  // Chips
  if (data.meta) {
    const chips = el("div", "chips");
    chips.append(
      el("span", "chip", "Intent: " + data.meta.overall_intent),
      el("span", "chip", "Emotion: " + data.meta.dominant_emotion),
      el("span", "chip", "Opinion share: " + Math.round(data.meta.opinion_share * 100) + "%")
    );
    root.append(chips);
  }

  // Gauges
  const g = el("div", "gauges");
  g.append(
    gauge("Truthfulness", s.truthfulness),
    gauge("Nuance", s.nuance),
    gauge("Framing", s.framing),
    gauge("Consistency (can only lower the score)", s.consistency),
    gauge("Manipulation safety", s.risk)
  );
  root.append(g);

  // Claims
  if (data.judgments.length) root.append(el("h2", "", "Fact checks"));
  for (const j of data.judgments) {
    const [label, cls] = VERDICTS[j.verdict] ?? ["Unknown", "neutral"];
    const card = el("div", "card");
    card.append(el("div", "claim", j.claim.text));
    if (j.claim.kind === "attribution") card.append(el("span", "badge neutral", "Did they say it?"));
    if (j.claim.kind === "embedded") card.append(el("span", "badge neutral", "Quoted statement, checked on its own"));
    if (j.ignored > 0) card.append(el("p", "status small", j.ignored + " source(s) ignored: same site as the text or copies of it"));
    card.append(el("span", "badge " + cls, label));
    if (j.consensus === "disputed" || j.consensus === "minority_view") {
      card.append(el("span", "badge warn", pretty(j.consensus)));
    }
    card.append(el("p", "why", j.explanation));
    for (const ev of j.evidence) {
      const p = el("p", "ev", (ev.stance ? ev.stance.toUpperCase() + ": " : "") + "\u201C" + ev.quote + "\u201D ");
      if (/^https?:\/\//.test(ev.url)) {
        const a = el("a", "", ev.url);
        a.href = ev.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        p.append(a);
      }
      card.append(p);
    }
    root.append(card);
  }
  if (data.failed > 0) {
    root.append(el("p", "status", data.failed + " claim(s) could not be checked."));
  }

  // Findings about the writing
  if (data.findings.length) root.append(el("h2", "", "How it is written"));
  const sorted = [...data.findings].sort((a, b) => b.severity - a.severity);
  for (const f of sorted) {
    const card = el("div", "card finding");
    const head = el("div", "finding-head");
    head.append(
      el("span", "cat", CATEGORY_LABELS[f.category] ?? f.category),
      el("span", "crit", pretty(f.criterion)),
      el("span", "sev sev" + f.severity, "\u25CF".repeat(f.severity) + "\u25CB".repeat(3 - f.severity))
    );
    card.append(head);
    if (f.quote) card.append(el("p", "ev", "\u201C" + f.quote + "\u201D"));
    card.append(el("p", "why", f.explanation));
    root.append(card);
  }

  root.append(el("p", "status small", "Scores are estimates based on the sources found, not verdicts."));
}

chrome.storage.session.get("pending").then(({ pending }) => {
  if (pending && Date.now() - pending.ts < 15000) run(pending.text, pending.pageUrl);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.pending?.newValue) {
    run(changes.pending.newValue.text, changes.pending.newValue.pageUrl);
  }
});