# Testing Heka on Windows

## Prerequisites

1. Install **QGIS LTR** with OSGeo4W. Heka detects the standard launcher automatically at `C:\OSGeo4W\bin\python-qgis-ltr.bat`.
2. Start OmniRoute locally. Heka expects its OpenAI-compatible endpoint at `http://localhost:20128/v1` by default. Override the endpoint, key, or model with `VITE_OMNIROUTE_BASE_URL`, `VITE_OMNIROUTE_API_KEY`, and `VITE_OMNIROUTE_MODEL` before building when required.
3. Keep an internet connection for the first Calgary run. Heka caches the public City of Calgary feature layers locally after downloading them.

## Start the app

Install either Windows bundle from `src-tauri\target\release\bundle`:

- `nsis\Heka_0.1.0_x64-setup.exe` — recommended installer.
- `msi\Heka_0.1.0_x64_en-US.msi` — MSI alternative.

Launch **Heka** from the Start menu or installation directory. The normal QGIS location is detected automatically. If QGIS is somewhere else, set `HEKA_QGIS_PYTHON` to the full path of its `python-qgis-ltr.bat` launcher before starting Heka.

## Verify OmniRoute

With OmniRoute running, submit a question in Heka. A working connection changes the planner from **OmniRoute is constructing a spatial plan...** to a populated Reasoning Inspector with a validated objective, graph, and Spatial DSL. A connection failure is shown in the composer instead of silently falling back to a mock planner.

## Run the Calgary fire-station demonstration

1. Enter: `Where should Calgary build another fire station?`
2. Press **Enter** and let the Replay Timeline finish planning.
3. Select **Run Calgary analysis**.
4. Watch the live execution stages: local data loading, Alberta 10TM reprojection, 5 km station coverage, coverage-gap scoring, candidate ranking, and export.
5. Heka adds the candidate layer to the Cesium globe and zooms to it. Use **Hide candidates** / **Show candidates** to toggle it.
6. Read the PyQGIS execution card in the Reasoning Inspector for feature count, runtime, generated layer, and warnings.

## Export location

By default, Heka writes cached source layers and results here:

`C:\Users\<you>\Documents\Heka\Calgary Fire Station Demo\`

The result is `exports\fire_station_candidates.geojson`, in WGS84 / CRS84 and ready to open in Cesium or QGIS. Set `HEKA_DATA_DIR` to use another local dataset-cache folder.

## Known limitations

- The demonstration ranks community-area coverage gaps with a **5 km straight-line buffer**. It is not road-network travel-time analysis and must not be treated as a city planning recommendation.
- The first run downloads public City of Calgary layers; later runs use the local cache.
- OmniRoute must run locally; Heka does not include a model or secret key.
- This build is purpose-built for the Calgary fire-station demo, not a generic GIS workflow engine.

## 60-second demo script

Open Heka. Type: **“Where should Calgary build another fire station?”** Press Enter. Point out the Replay Timeline as OmniRoute turns the question into a validated workflow. Open the Reasoning Inspector: objective, source datasets, constraints, graph, and Spatial DSL are visible rather than hidden behind chat text. Click **Run Calgary analysis**. Narrate the execution steps while the globe receives ranked candidate points. Toggle the candidates, select a point, and show the execution card: the output was created by QGIS Processing, saved as GeoJSON, and carries a clear 5 km coverage-proxy warning.
