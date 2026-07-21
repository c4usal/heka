# Heka Web (Cloudflare)

Public **Ask Earth** demo for judges and anyone with a browser.

**Live:** https://heka-web.ulofeuduokhai.workers.dev

Heka is to GIS what Cursor is to programming — you describe the spatial problem; the agent plans evidence, acquires open data, scores sites, and maps an explainable result. This web build is the AI + globe experience. For the full desktop Spatial IDE (QGIS Processing, richer imports), install from the repo root README.

## What runs where

| Piece | Host |
|-------|------|
| React UI + Cesium (CDN) | Worker static assets |
| Earth Agent `POST /api/ask` | Same Worker |
| Geocode + OSM helpers `/api/*` | Same Worker |
| Planner LLM | `heka-ai-gateway` (secrets) |

## Judge checklist

1. Ask a Calgary hospital or Lagos bridge question
2. Watch the progress checklist (not a fake spinner)
3. Click a ranked site → camera flies
4. Drag a GeoJSON / KML / CSV onto the map
5. Follow up in chat (conversation appends, does not replace)

## Redeploy

```bash
npm run web:deploy
```
