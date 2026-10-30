# Aletheia

**Select text on any webAletheia page, click once, and see how true, balanced and manipulative it is.**

Aletheia is a Chrome extension backed by an AI pipeline. It splits a text into claims, checks each claim against independent web sources, and separately analyzes *how* the text is written (nuance, framing, emotional language, internal consistency, manipulation signals). The result is a set of gauges, not a single verdict, so a text that is factually correct but heavily slanted is shown as exactly that.

Built for the **Nebius x NVIDIA Global AI Hackathon 2026**.

- **Track:** Apps & Agents
- **Team:** Prosenchyma and Mercurry91

## How it works

```
Selected text -> Chrome extension -> Backend API (Nebius VM)
                                        |
        +-------------------------------+--------------------------------+
        | Fact-checking                                  | Writing analysis |
        | 1. Split into self-contained claims            | 5 parallel runs, |
        | 2. Search the web (Tavily), in 2 languages     | 6 category       |
        | 3. Classify every source's stance              | ratings, trimmed |
        | 4. Code computes the verdict                   | mean             |
        +-------------------------------+--------------------------------+
                                        |
                        Scores computed in code -> side panel
```

Key design decisions:

- **The model never outputs the final numbers.** It classifies (source stance, rating 0 to 4 per category). Code turns those into scores, so results are reproducible and tunable.
- **Reported speech is split in two.** "X said Y" becomes *did X say it?* and *is Y true?*.
- **Circular sourcing is blocked.** Sources from the same site as the selected text, and near-copies of it, are discarded.
- **Absolute claims need explicit backing.** A flat superlative ("nobody does it better") with no reliable source behind it scores low. A claim marked as personal opinion ("I think...") is not scored.
- **No evidence is not the same as false.** Ordinary claims with no sources are shown as "not verified" and excluded from the score.
- **Stability measures:** temperature 0 for fact-checking, search results cached, writing analysis averaged over 5 runs (highest and lowest dropped), scores rounded to the nearest 5, and findings only shown if their quote really appears in the text.

## Scores

| Gauge | Based on |
|---|---|
| **Truthfulness** | Verdicts per claim (supported 100, mostly supported 80, mixed 50, mostly contradicted 20, contradicted 0, unsupported absolute claim 10), weighted by importance |
| **Nuance** | Absolutism, oversimplification, caveats, causation vs correlation, logic and fallacies |
| **Framing** | Word choice, omissions, cherry-picking, emotional language, appeals to fear or identity |
| **Consistency** | Internal contradictions, shifting stance, tone vs facts. Can only lower the overall score. |
| **Manipulation safety** | Anonymous sources, conspiracy patterns, distrust of established sources |
| **Overall** | Weighted average, shrunk toward 50 when confidence is low, capped when truthfulness is very low |

Scores are **estimates based on the sources found, not verdicts**. The panel also shows a confidence level, the dominant emotion, the text's likely intent and the share of opinion, and it flags contested topics.

## Tech stack

- **Models:** NVIDIA Nemotron 3 Super 120B (`nvidia/nemotron-3-super-120b-a12b`) on **Nebius Token Factory**, called through its OpenAI-compatible API
- **Search:** Tavily
- **Backend:** Node.js, TypeScript, Express (run with `tsx`)
- **Extension:** Chrome Manifest V3, plain HTML, CSS and JavaScript (side panel)

## Run it locally

Requirements: Node.js (LTS), Git, Chrome, a Nebius Token Factory API key and a Tavily API key.

```
git clone https://github.com/prosenchyma/aletheia.git
cd aletheia/server
npm install
copy .env.example .env
```

Open `server/.env` and fill in your keys (macOS and Linux: use `cp` instead of `copy`). Then start the server:

```
npx tsx src/server.ts
```

It listens on `http://localhost:3000`. Health check: `http://localhost:3000/health`.

### Load the extension

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension` folder.
3. On any page, select some text (at least 20 characters), right-click, and choose **Check with TruthCheck**. The side panel opens with the analysis.

To use a deployed backend instead of localhost, change `API` at the top of `extension/sidepanel.js` and the `host_permissions` entry in `extension/manifest.json`, then reload the extension.

## Settings (`server/.env`)

| Variable | Purpose | Default |
|---|---|---|
| `NEBIUS_API_KEY` | Nebius Token Factory key |
| `TAVILY_API_KEY` | Tavily search key |
| `NO_THINK` | `1` turns off long hidden reasoning on fast steps (much faster) | off |
| `MAX_CONCURRENT` | Maximum simultaneous model calls | 16 |
| `STANCE_RUNS` | How many times each claim's sources are classified (more is steadier but slower) | 1 |
| `PER_IP_PER_HOUR` | Rate limit per visitor | 20 |
| `DAILY_CAP` | Total requests per day, to protect credits | 500 |

## Testing and calibration

```
cd server
npx tsx src/calibrate.ts
```

Runs three contrasting texts (neutral, factually true but slanted, false and viral) and prints their scores. The ranking should be neutral above slanted above false.

```
npx tsx src/repeat.ts
```

Runs one text five times, bypassing the cache, and prints the spread per gauge. Create `server/sample.txt` with any test text first.

## Limitations

- Obscure, local or non-English claims often have no independent sources. They are shown as "not verified", which does not mean they are false.
- Results depend on what the search returns. Paywalled or very new information may be missing.
- Language models are not perfectly repeatable. The measures above reduce the variation but do not remove it.
- Claims that need a name the text does not contain (for example only "he said") cannot be resolved and are skipped.
- On contested value questions (politics, religion, ethics) the tool flags the topic and shows the evidence instead of claiming a verdict.
- This is a hackathon prototype, not a replacement or an alternative for professional fact-checking.

## Project structure

```
extension/     Chrome extension (manifest, background, side panel)
server/
  src/
    server.ts      API, caching, rate limiting
    extract.ts     claim extraction
    tavily.ts      web search with caching
    judge.ts       source stances, verdicts, truthfulness score
    analysis.ts    writing analysis (6 categories, trimmed mean)
    scoring.ts     gauges, confidence, overall score
    trust.ts       domain trust list
    llm.ts         Nebius client, concurrency limit, JSON repair
    calibrate.ts   ranking test
    repeat.ts      stability test
```
