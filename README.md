# Heka

> Ask Earth.

**Heka is to GIS what Cursor is to programming** — an AI-native Spatial Reasoning IDE. You describe a spatial problem in plain language; Heka plans the analysis, pulls open evidence, runs geospatial tools, and returns an interactive, explainable map — not invented coordinates in chat.

**Built for [OpenAI Build Week](https://openai.devpost.com)** with **Codex** and **GPT-5.6**.

---

## Try it (judges — start here)

| Surface | Link | What you get |
| --- | --- | --- |
| **Web demo** | https://heka-web.ulofeuduokhai.workers.dev | Conversational Ask Earth + Cesium globe. Open-web search + open-data GIS when the question needs it. |
| **Windows IDE** | [Download page](https://heka-web.ulofeuduokhai.workers.dev/#/download) → GitHub Releases (`Heka_*_x64-setup.exe`) | Full Spatial IDE: multi-document tabs, imports, optional QGIS Processing. |

No local API keys required for the hosted demo. Provider secrets stay on the Cloudflare AI gateway.

### 60-second judge path (web)

1. Open the [web demo](https://heka-web.ulofeuduokhai.workers.dev).
2. Ask: **Where should Calgary build its next hospital considering population, roads, flood risk, and growth?**
3. Watch the live progress checklist (plan → evidence → tools → score).
4. Click a ranked candidate — the camera flies to the site.
5. Follow up in chat (multi-turn appends; it does not wipe the map).
6. Optional: drag a GeoJSON / KML / CSV onto the globe.

Other good prompts:

- Where should Lagos build its next bridge across the lagoon?
- What’s the most dangerous place in Lethbridge? *(search-first; not forced into a hospital-siting demo)*

---

## What it is (and isn’t)

| Heka is | Heka is not |
| --- | --- |
| A planner that proposes **what to measure** | ChatGPT with a map pasted on |
| Tools that **compute** the answer (OSM, scoring, optional QGIS) | An LLM inventing lat/lon |
| Explainable layers, candidates, DSL, discovery gaps | A black-box “trust me” pin |
| Web Earth Agent + full Windows Spatial IDE | Mac-ready yet (Windows first) |

```text
Natural language
  → Understand (chat vs place research vs siting)
  → Open-web search / research     ← primary skill when facts matter
  → Earth planner (themes, weights)  ← never executes GIS itself
  → Tools: geocode, OSM, demand, score (+ QGIS on desktop)
  → EarthResponse { answer, layers, candidates, dsl, discovery, trace }
  → Cesium + conversation
```

---

## Built with Codex + GPT-5.6

This project was **authored primarily in Codex** using **GPT-5.6**. The Codex Session ID from the primary build thread is on the Devpost submission form (`/status` in that thread).

### How Codex accelerated the workflow

Codex was the main engineering partner across the Build Week push, not a one-off autocomplete:

- **Scaffolded the Earth Agent stack** on Cloudflare Workers (`services/heka-web`): agent loop, tools, connectors, OSM helpers, site scorer, and static UI hosting for judges.
- **Separated “AI plans” from “tools compute”** — planner emits themes/weights/evidence needs; deterministic tools produce candidates and layers so the model cannot invent flood maps or census geometry.
- **Drove the product split** between a browser Earth Agent (search-first, conversational) and a packaged Windows IDE (tabs, imports, QGIS Processing) after iterating on failure modes like “most dangerous place in Lethbridge” collapsing into an unrelated siting demo.
- **Wired the hosted AI gateway** (`services/ai-gateway`) so keys never ship to the client, with open research (DuckDuckGo + Wikipedia) before structured planning.
- **Iterated UI/UX** for the demo banner, download path, Reasoning Inspector, and globe interaction so judges can evaluate without rebuilding from scratch.

### Key product / engineering decisions (with Codex)

1. **Search before GIS** — internet research is a first-class skill; Overpass/scoring run only when the question is spatial.
2. **Evidence honesty** — Need / Found / Gaps in discovery; limitations and assumptions are returned with every answer.
3. **Two surfaces, one idea** — web proves the agent; Windows is the full GIS engineer workspace.
4. **Secrets at the edge** — OpenAI/Groq/Gemini keys live only as Worker secrets.

### How GPT-5.6 was used

- **Primary build model in Codex** for architecture, agent design, Workers code, React/Tauri workspace, prompts, and submission packaging.
- **Planning / narration path** in the product stack via the hosted gateway (structured planning + conversational answers grounded in tool and search results).
- Fallback providers (e.g. Groq) exist for resilience during demos; the **meaningful GPT-5.6 usage for Build Week is the Codex-authored system** and the OpenAI-backed planning path documented here and in the demo video.

---

## Repository layout

```text
heka/
  src/                    # React Spatial IDE (Tauri shell)
  src-tauri/              # Windows desktop packaging
  services/
    heka-web/             # Public Ask Earth Worker + API + static UI
    ai-gateway/           # Planner LLM gateway (secrets stay here)
  docs/                   # Architecture + product direction
  TESTING.md              # Windows / QGIS demo notes
```

---

## Local setup

### Prerequisites

- Node.js 20+
- For full Windows IDE: [Tauri](https://v2.tauri.app/) prerequisites; optional [QGIS LTR](https://qgis.org/) for Processing (`C:\OSGeo4W\bin\python-qgis-ltr.bat` by default)
- Cloudflare account + `wrangler` only if you redeploy Workers yourself

### Web demo (recommended for most judges)

Judges should use the **hosted** URL above. To run locally against the same stack:

```bash
npm install
npm run web:dev          # builds UI and serves via services/heka-web
```

Redeploy the public demo:

```bash
npm run web:deploy
```

### Full Windows IDE

```bash
npm install
npm run tauri:dev              # desktop app, hot reload
npm run tauri:build:windows    # NSIS / MSI under src-tauri/target/release/bundle
```

Installer artifacts (when published): GitHub Releases — `Heka_*_x64-setup.exe`.

See [TESTING.md](./TESTING.md) for QGIS-backed Calgary fire-station verification and known limitations.

### AI gateway (optional self-host)

```powershell
cd services/ai-gateway
npm install
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GROQ_API_KEY   # optional fallback
npm run deploy
```

Details: [services/ai-gateway/README.md](./services/ai-gateway/README.md). Never commit `.dev.vars` or API keys.

---

## Sample questions & expected behavior

| Question | Expected behavior |
| --- | --- |
| Calgary next hospital… | Geocode → evidence plan → OSM/open layers → scored candidates on globe + written rationale |
| Lagos next bridge… | Bridge-oriented themes/weights; candidates along crossing context |
| Civics / “dangerous place in …” | Search + narration first; GIS only if spatial layers help |
| Follow-up in the same thread | Conversation continues; map state updates rather than a cold restart |

Exports (desktop): GeoJSON under the project data dir (default `Documents\Heka\…`). Web: inspect candidates/layers in the UI.

---

## Track & licensing

- **Hackathon track:** Apps for Your Life — ask Earth where to site hospitals, bridges, and other real-world decisions; the Spatial IDE is how that answer becomes inspectable.
- **Pre-existing vs Build Week:** Core IDE shell existed earlier; Build Week meaningfully extended it with the Earth Agent web surface, search-first agent loop, open-data scoring path, hosted demo, and packaging polish — authored with Codex + GPT-5.6 (see commit history and Session ID on Devpost).
- Third-party: Cesium, React, Tauri, QGIS (optional), OpenStreetMap / public open data — comply with their licenses when redistributing.

---

## Team note

Questions about running the demo: use the web URL first. Desktop QGIS runs are documented in [TESTING.md](./TESTING.md); they are **not** required to evaluate the Earth Agent story.
