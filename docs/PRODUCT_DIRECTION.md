# Heka product direction (locked from product owner)

> Captured so execution matches ambition. Do not water this down.

## One-line product

**Heka is to GIS what Cursor is to programming** — an AI-native Spatial Reasoning IDE. The web build is a focused Earth Agent demo; Windows is the full IDE.

## What the owner required (verbatim intent)

### 1. AI must not be boxed

- Boxing the agent inside a fixed GIS tool list is what caused failures like “most dangerous place in Lethbridge” becoming a hospital siting demo.
- **Internet search is the most important skill** — more important than Overpass alone.
- The agent must be allowed to **search the open web**, parse useful sources / open databases, and return real answers.
- Prefer **existing open-source GitHub projects / libraries** over reinventing capabilities from scratch.
- Be **conversational**: GIS *or* non-GIS. Understand the question, talk and explain clearly and nicely.
- Know **when** to call GIS tools — and when not to.
- Then execute spatial work when appropriate.

### 2. Web vs full IDE

| Surface | Role |
| --- | --- |
| **Web demo** | Earth Agent that “knows everything” — normal questions + spatial. Smart tool use. Not the full GIS IDE chrome. |
| **Windows IDE** | Packaged desktop app with Heka logo. Full IDE: multi-document tabs, imports, QGIS Processing, everything a GIS engineer expects. |

### 3. Web chrome (explicit UI ask)

- Remove the top File / Edit / View / Run / command-search bar on **web**.
- Replace with a **stylish banner**: simple text + link:
  - “This is just a web demo of the full IDE. Download it here.”
- Link goes to a **download page for Windows only** (Mac not ready — do not advertise Mac).
- Multi-document “+” control must **not** say “Coming soon.” Copy should say that multi-document tabs are available in the **full Windows IDE**.

### 4. Full Windows IDE

- Packaged installer (NSIS / MSI as already documented).
- Show Heka logo properly.
- Enable the GIS engineer workflow: projects, layers, import, analysis, QGIS execution, globe, conversation.

## Execution checklist

- [x] Document requirements (this file)
- [x] Add first-class `web_search` (+ GitHub open-source search) to Earth Agent
- [x] Conversational agent: search-first, GIS tools only when needed, clear explanations
- [x] Web: replace menu chrome with demo banner → `/download`
- [x] Windows download page (no Mac)
- [x] Tabs copy: available in full IDE
- [x] README / download page point at Windows installer story + logo
- [x] Redeploy web; smoke: Canada civics, Lethbridge danger (search), Calgary hospital

## Architecture implication

```text
Question
  → Understand (conversational)
  → web_search / open research   ← primary skill
  → If spatial: connectors + OSM + score (+ QGIS on desktop)
  → Explain clearly
  → Map only when it helps
```

AI plans and explains. Engines and the open web supply evidence. Never invent flood maps, crime scores, or census when search/connectors did not provide them.
