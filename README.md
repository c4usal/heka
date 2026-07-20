# Heka

> **Ask Earth.**

Heka is an AI geospatial analyst that turns natural-language questions into professional spatial analysis and interactive maps.

## The idea

Spatial questions that matter should not require someone to learn GIS software, hunt for plugins, repair coordinate systems, and manually stitch together an analysis. Heka lets people ask the question directly, then makes the reasoning visible.

**Instead of:** question → GIS software → data wrangling → many tools → exported map

**Heka:** question → AI-built spatial workflow → GIS engine → interactive, evidence-backed answer

Heka is not positioned as “AI for GIS.” It is a natural-language interface for spatial reasoning: a way to ask meaningful questions about cities, infrastructure, emergency response, climate risk, food access, mobility, and the physical world.

## The experience

The homepage is deliberately simple: a beautiful globe and one prompt.

> Ask Earth anything…

Example questions:

- Where is the best place for a new hospital?
- If this bridge collapsed tomorrow, what communities become isolated?
- Which neighborhoods are food deserts?
- Where should drone hubs be built?
- What land is suitable for affordable housing but outside flood risk?

Rather than a generic “thinking” spinner, Heka shows an inspectable workflow being assembled and executed:

1. Understanding request
2. Detecting datasets
3. Loading roads, facilities, population, and risk layers
4. Running spatial operations
5. Generating and ranking candidate locations
6. Explaining the result and confidence

The map comes alive layer-by-layer. A **Reasoning** panel explains why each recommendation was selected, including population served, travel time, risk, land availability, assumptions, and confidence. A **Workflow Replay** timeline lets users inspect each intermediate map and analysis stage.

## The hackathon “holy-shit” moment

A judge asks:

> If this bridge collapsed tomorrow, what communities become isolated?

Heka zooms to the location, displays the road graph and alternate routes, highlights affected population clusters, and reports an evidence-backed estimate of the impact plus possible mitigation projects.

The point is not a dashboard. It is watching a spatial reasoning engine turn a real-world question into a defensible answer.

## Technical approach

```text
React frontend
  ↓
MapLibre or Cesium visualization
  ↓
Backend planner powered by GPT-5.6
  ↓
Spatial workflow DSL
  ↓
GIS execution engine (PyQGIS, GDAL, optional PostGIS)
  ↓
Layers, metrics, and explanation returned to the map
```

The model does **not** directly execute arbitrary Python. It produces a constrained spatial workflow that the engine validates and compiles. This enables safe, debuggable operations such as loading datasets, buffering, intersecting, filtering, drive-time analysis, scoring, candidate generation, and visualization.

Example workflow:

```yaml
load:
  - hospitals
  - roads
  - population

operations:
  - drive_time:
      hospitals: 15min
  - intersect:
      population
  - score:
      access

visualize: heatmap
```

## MVP focus

Build one polished, credible decision flow rather than a fully general GIS platform:

> Where should we place the next emergency facility to improve coverage while avoiding flood risk?

Use a curated set of datasets and a small, reliable spatial-operation vocabulary. Make the workflow replay and explanation panel excellent. QGIS/PyQGIS is the invisible execution engine—not the headline.

## Vision

Heka begins with public geographic data, but the underlying interface can reason over campuses, factories, warehouses, farms, hospitals, and any mapped environment. The long-term ambition is a natural-language interface to spatial reasoning engines.
