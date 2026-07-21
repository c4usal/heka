# Heka

> Ask Earth.

Heka is a desktop Spatial Reasoning IDE. It turns natural-language questions into explainable, reproducible geospatial workflows executed by professional GIS engines.

## The product

People should not need to learn GIS tools, find plugins, repair coordinate systems, and assemble workflows before they can answer an important question about a place. Heka lets them state the objective, then makes the analysis and its evidence inspectable.

Heka is not an AI chatbot, QGIS wrapper, website, map viewer, or Python-code generator. It is a persistent desktop environment for reasoning about the physical world.

## Experience

Start with a question:

- Where should Calgary place another fire station?
- Which neighbourhoods are underserved by hospitals?
- Which bridges would isolate communities if they failed?
- Which sites are suitable for EV chargers?

Heka identifies relevant datasets, extracts constraints, constructs a workflow, validates it, runs it through a deterministic GIS backend, and returns an interactive map plus the evidence behind the result.

The workspace includes:

- Project, dataset, layer, plugin, and history navigation
- Interactive globe and map view
- Reasoning Inspector for assumptions, constraints, provenance, workflow graph, and confidence
- Replay Timeline for intent, dataset selection, workflow generation, validation, execution, visualization, and explanation
- Local logs, exports, cache, and project data

## Architecture

```text
Natural language
  -> Planner
  -> Spatial Reasoning Graph
  -> Backend-independent Spatial DSL
  -> Validation and compiler
  -> Spatial runtime
  -> Backend adapter (initially PyQGIS)
  -> Visualization and explanation
```

Language models plan and explain. They never execute spatial operations or fabricate results. The runtime is deterministic: given the same datasets, parameters, and software versions, it produces the same outputs.

The planner emits a stable workflow representation rather than raw code. The runtime validates and compiles that representation into backend-specific operations.

## Initial scope

The initial use case is emergency-facility placement: improve population coverage while avoiding flood risk. It uses a curated vocabulary of operations such as loading datasets, buffering, intersections, overlays, routing, scoring, ranking, and visualization.

Heka builds on existing GIS engines rather than replacing them. QGIS/PyQGIS is an execution engine, not the product headline.

## First live analysis: data-validated facility coverage

In the desktop app, submit a Calgary fire-station question. Heka's Groq-backed structured planner compares the required datasets and DSL to the local catalog; only an executable plan starts the background PyQGIS worker. The worker caches the Calgary fire-station and community-boundary GeoJSON files locally, reprojects them to Alberta 10TM, and invokes QGIS Processing algorithms for buffer, difference, area scoring, centroid generation, ranking, and GeoJSON export. The resulting candidate layer is added to Cesium and can be toggled on and off without removing previous result layers.

The current demonstration uses a transparent 5 km straight-line coverage proxy, not a road-network response-time model. Heka surfaces that limitation in the execution result rather than presenting it as operational advice.

### Local runtime setup

Install QGIS LTR through OSGeo4W, then run Heka normally. The expected launcher is `C:\OSGeo4W\bin\python-qgis-ltr.bat`; override it with `HEKA_QGIS_PYTHON` when QGIS is installed elsewhere. Heka uses its hosted planner gateway, so no local model service or provider key is required. Set `HEKA_DATA_DIR` to choose the directory used for locally cached demo data and exported GeoJSON. The worker never receives executable code from the planner: it compiles only a reviewed, capability-checked Spatial DSL into QGIS Processing calls in `worker/heka_worker.py`.

## Repository layout

- `src/` - React desktop workspace, application ports, domain model, and infrastructure adapters
- `src-tauri/` - Tauri desktop shell and IPC command boundary
- `worker/` - Python JSON-lines worker contract for workflow validation and future PyQGIS execution
- `docs/ARCHITECTURE.md` - module boundaries and project-folder model

## Vision

Heka begins with public geographic data but can eventually reason over cities, campuses, factories, warehouses, farms, hospitals, and other mapped environments. Its goal is a natural-language interface to trustworthy spatial reasoning engines.
