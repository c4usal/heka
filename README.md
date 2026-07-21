# Heka

> **Ask Earth.**
>
> **Heka is an AI-native Spatial Reasoning IDE — think Cursor for GIS.**
>
> Describe a geographic problem in plain English, and Heka plans the analysis, discovers relevant geographic evidence, executes deterministic spatial workflows, and returns an explainable interactive map.

Built for **OpenAI Build Week** using **Codex** and **GPT-5.6**.

---

# Why Heka?

Traditional GIS software assumes users already know:

- which datasets they need
- where to find them
- which GIS tools to run
- what order to run them in

Heka reverses that workflow.

Instead of manually building GIS pipelines, users simply describe the problem:

> **"Where should Calgary build its next hospital?"**

Heka then:

1. Understands the request.
2. Researches the location when needed.
3. Discovers available spatial datasets.
4. Plans a spatial workflow.
5. Executes deterministic GIS operations.
6. Explains every result.
7. Produces an interactive 3D map.

The AI **never invents geographic answers.**

It plans.

Spatial tools compute.

---

# Try Heka

## 🌍 Web Demo (Recommended)

**https://heka-web.ulofeuduokhai.workers.dev**

No installation required.

Perfect for judging.

Features:

- Natural-language Earth Agent
- Interactive Cesium globe
- Open-web research
- OpenStreetMap-powered spatial reasoning
- Conversation history
- Explainable planning

---

## 🖥 Windows Spatial IDE

Download from **GitHub Releases**

Features:

- Multi-document GIS workspace
- Dataset management
- Drag-and-drop GeoJSON/KML/CSV
- AI planning
- Cesium visualization
- Optional QGIS Processing
- GeoJSON export

---

# Example Questions

### General

- Where is Lethbridge?
- Which city has the largest population in Canada?
- Tell me about Lagos.

### Spatial Planning

- Where should Calgary build its next hospital?
- Where should Lagos build another bridge?
- Which neighbourhoods lack healthcare coverage?
- Where would a new fire station reduce response times the most?

### GIS Workflow

- Import this GeoJSON.
- Compare the top candidate locations.
- Export this analysis.

---

# Architecture

```
Natural Language

        │

        ▼

GPT-5.6 Planner

        │

        ▼

Evidence Discovery
(Open Web + Open Data)

        │

        ▼

Spatial Tools
(OpenStreetMap • Scoring • QGIS)

        │

        ▼

Interactive Cesium Globe

        │

        ▼

Explainable Results
```

The planner decides **what should be measured.**

Deterministic GIS tools perform the actual computation.

---

# What Makes Heka Different?

| Heka | Traditional GIS |
|-------|-----------------|
| Ask questions in natural language | Manually build workflows |
| Automatically discovers datasets | User must find data |
| Plans analyses with AI | User decides every processing step |
| Explainable reasoning | Tool chains only |
| Interactive Earth interface | Desktop GIS only |

---

# Built with Codex

Heka was engineered primarily using **Codex with GPT-5.6** during OpenAI Build Week.

Codex helped build:

- Earth Agent
- React interface
- Cesium integration
- Cloudflare Workers
- Hosted AI Gateway
- Spatial planner
- Dataset discovery
- QGIS integration
- Documentation
- Deployment

The primary Codex Session ID is included in the Devpost submission.

---

# GPT-5.6

GPT-5.6 powers Heka's planning layer.

Rather than generating GIS answers directly, it:

- understands intent
- plans analyses
- identifies required datasets
- produces structured execution plans

Deterministic GIS tools execute those plans, making every answer reproducible and explainable.

---

# Build Week Highlights

During OpenAI Build Week Heka gained:

- AI-native Earth Agent
- Hosted planning gateway
- Search-first reasoning
- OpenStreetMap dataset discovery
- Structured planning
- Explainable execution
- Interactive Cesium globe
- Windows Spatial IDE
- QGIS Processing integration
- Downloadable desktop application

---

# Repository Structure

```
heka/

├── src/                    React Spatial IDE

├── src-tauri/              Windows desktop shell

├── worker/                 Spatial execution worker

├── services/

│   ├── heka-web/           Public web demo

│   └── ai-gateway/         Hosted planner

├── docs/

└── TESTING.md
```

---

# Running Locally

## Requirements

- Node.js 20+
- Rust (desktop)
- Tauri prerequisites
- Optional: QGIS LTR

---

## Web Demo

```bash
npm install

npm run web:dev
```

Deploy:

```bash
npm run web:deploy
```

---

## Windows IDE

```bash
npm install

npm run tauri:dev
```

Build:

```bash
npm run tauri:build:windows
```

---

# AI Gateway (Optional)

```bash
cd services/ai-gateway

npm install

npx wrangler secret put OPENAI_API_KEY

npm run deploy
```

Secrets remain on Cloudflare Workers and are never shipped to the client.

---

# Current Capabilities

✅ Natural-language spatial reasoning

✅ Interactive 3D globe

✅ OpenStreetMap integration

✅ Explainable planning

✅ Dataset discovery

✅ Conversation history

✅ GeoJSON export

✅ Optional QGIS Processing

---

# Hackathon Track

**Work & Productivity**



It transforms complex spatial analysis into a conversational workflow while keeping every dataset, computation, and assumption transparent.

---

# Vision

Cursor transformed software development by making AI a first-class programming partner.

Heka applies the same philosophy to geospatial analysis.

Instead of asking users to memorize GIS workflows, Heka lets them describe the problem—and makes every planning step, dataset, and computation transparent.

## Ask Earth.
