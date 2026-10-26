const API = "http://localhost:3000/analyze";
const root = document.getElementById("root");

const LABELS = {
  supported: ["Supported", "good"],
  mostly_supported: ["Mostly supported", "good"],
  mixed: ["Mixed / missing context", "warn"],
  mostly_contradicted: ["Mostly contradicted", "bad"],
  contradicted: ["Contradicted", "bad"],
  insufficient: ["Not enough evidence", "neutral"],
};

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

async function run(text) {
  root.replaceChildren(
    el("p", "status", "Checking claims... this takes about 10-20 seconds."),
    el("blockquote", "quote", text.slice(0, 300))
  );
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
    render(text, data);
  } catch (e) {
    root.replaceChildren(el("p", "error", "Something went wrong: " + e.message));
  }
}

function render(text, data) {
  root.replaceChildren();
  root.append(el("blockquote", "quote", text.slice(0, 300)));

  const score = el("div", "score");
  score.append(
    el("div", "num", data.truthfulness === null ? "N/A" : data.truthfulness + " / 100"),
    el("div", "sub", "Truthfulness estimate, based on the sources found")
  );
  root.append(score);

  for (const j of data.judgments) {
    const [label, cls] = LABELS[j.verdict] ?? ["Unknown", "neutral"];
    const card = el("div", "card");
    card.append(
      el("div", "claim", j.claim.text),
      el("span", "badge " + cls, label),
      el("p", "why", j.explanation)
    );
    for (const ev of j.evidence) {
      const p = el("p", "ev", "\u201C" + ev.quote + "\u201D ");
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
}

chrome.storage.session.get("pending").then(({ pending }) => {
  if (pending && Date.now() - pending.ts < 15000) run(pending.text);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.pending?.newValue) {
    run(changes.pending.newValue.text);
  }
});