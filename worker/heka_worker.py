"""Heka's local PyQGIS worker for the Calgary fire-station vertical slice.

It invokes QGIS Processing algorithms; it never receives LLM-generated GIS code.
Protocol: JSON-lines over stdin/stdout. Progress events are safe for Tauri IPC forwarding.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any

DATA_URLS = {
    # Official City of Calgary public feature layers. ArcGIS remains reachable when
    # the City's Socrata endpoint rate-limits or rejects desktop-worker requests.
    "fire_stations": "https://services1.arcgis.com/AVP60cs0Q9PEA8rH/arcgis/rest/services/Fire_Stations/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson",
    "communities": "https://services1.arcgis.com/AVP60cs0Q9PEA8rH/arcgis/rest/services/Community_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson",
}
native_provider: Any | None = None
qgis_application: Any | None = None

def emit(kind: str, payload: dict[str, Any]) -> None:
    print(json.dumps({"type": kind, "payload": payload}), flush=True)

def progress(stage: str, percent: int, detail: str) -> None:
    emit("progress", {"stage": stage, "percent": percent, "detail": detail})

def data_directory(message: dict[str, Any]) -> Path:
    configured = message.get("dataDirectory") or os.environ.get("HEKA_DATA_DIR")
    return Path(configured) if configured else Path.home() / "Documents" / "Heka" / "Calgary Fire Station Demo" / "datasets"

def bootstrap(data_dir: Path) -> dict[str, str]:
    data_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, str] = {}
    for index, (name, url) in enumerate(DATA_URLS.items(), start=1):
        target = data_dir / f"{name}.geojson"
        if not target.exists():
            progress("dataset-download", index * 10, f"Downloading Calgary {name.replace('_', ' ')}")
            request = urllib.request.Request(url, headers={"User-Agent": "Heka-Spatial-Reasoning-IDE/0.1 (+https://github.com/c4usal/heka)", "Accept": "application/geo+json, application/json"})
            with urllib.request.urlopen(request, timeout=30) as response:
                target.write_bytes(response.read())
        paths[name] = str(target)
    return paths

def setup_qgis() -> None:
    global native_provider, qgis_application
    prefix = os.environ.get("QGIS_PREFIX_PATH", r"C:\OSGeo4W\apps\qgis-ltr")
    plugin_path = str(Path(prefix) / "python" / "plugins")
    if plugin_path not in sys.path:
        sys.path.insert(0, plugin_path)
    from qgis.core import QgsApplication
    from qgis.analysis import QgsNativeAlgorithms
    from processing.core.Processing import Processing
    QgsApplication.setPrefixPath(prefix, True)
    if qgis_application is None:
        qgis_application = QgsApplication.instance() or QgsApplication([], False)
        qgis_application.initQgis()
    Processing.initialize()
    if native_provider is None:
        native_provider = QgsNativeAlgorithms()
        qgis_application.processingRegistry().addProvider(native_provider)

def export_map_layer(layer: Any, layer_id: str, name: str, kind: str, output_dir: Path, work_dir: Path) -> dict[str, Any]:
    """Export every display layer from QGIS itself in WGS84 for Cesium.

    Keeping this conversion in the worker makes the viewer a faithful rendering of
    the processing outputs rather than a second implementation of spatial logic.
    """
    import processing
    from qgis.core import QgsVectorLayer
    display = processing.run("native:reprojectlayer", {
        "INPUT": layer, "TARGET_CRS": "EPSG:4326", "OUTPUT": str(work_dir / f"{layer_id}_wgs84.gpkg")
    })["OUTPUT"]
    path = output_dir / f"{layer_id}.geojson"
    exported = processing.run("native:savefeatures", {"INPUT": display, "OUTPUT": str(path)})["OUTPUT"]
    verified = QgsVectorLayer(exported, name, "ogr")
    if not verified.isValid():
        raise RuntimeError(f"QGIS could not open the exported {name} map layer.")
    return {"id": layer_id, "name": name, "kind": kind, "geojson": path.read_text(encoding="utf-8"), "featureCount": verified.featureCount(), "outputPath": str(path)}

def run_fire_station_analysis(message: dict[str, Any]) -> dict[str, Any]:
    try:
        setup_qgis()
        from qgis.core import QgsVectorLayer
        import processing
    except Exception as error:
        raise RuntimeError(f"PyQGIS is unavailable. Install QGIS LTR and set QGIS_PREFIX_PATH if needed. ({error})") from error

    started = time.perf_counter(); data_dir = data_directory(message); paths = bootstrap(data_dir)
    missing = [name for name, path in paths.items() if not Path(path).exists()]
    if missing: raise RuntimeError(f"Required local datasets are missing: {', '.join(missing)}")
    work_dir = Path(tempfile.mkdtemp(prefix="heka-fire-stations-")); target_crs = "EPSG:3400"  # NAD83 / Alberta 10TM
    progress("dataset-load", 35, "Loading local Calgary station and boundary layers")
    stations = QgsVectorLayer(paths["fire_stations"], "Fire stations", "ogr")
    communities = QgsVectorLayer(paths["communities"], "Community districts", "ogr")
    if not stations.isValid() or not communities.isValid(): raise RuntimeError("QGIS could not read one or more local GeoJSON datasets.")
    progress("reproject", 45, "Reprojecting layers into Alberta 10TM for meter-based analysis")
    stations_projected = processing.run("native:reprojectlayer", {"INPUT": stations, "TARGET_CRS": target_crs, "OUTPUT": str(work_dir / "stations.gpkg")})["OUTPUT"]
    communities_projected = processing.run("native:reprojectlayer", {"INPUT": communities, "TARGET_CRS": target_crs, "OUTPUT": str(work_dir / "communities.gpkg")})["OUTPUT"]
    progress("buffer", 55, "Generating 5 km fire-station coverage areas")
    coverage = processing.run("native:buffer", {"INPUT": stations_projected, "DISTANCE": 5000, "SEGMENTS": 16, "END_CAP_STYLE": 0, "JOIN_STYLE": 0, "MITER_LIMIT": 2, "DISSOLVE": True, "OUTPUT": str(work_dir / "coverage.gpkg")})["OUTPUT"]
    progress("difference", 67, "Finding community areas outside existing coverage")
    gaps = processing.run("native:difference", {"INPUT": communities_projected, "OVERLAY": coverage, "GRID_SIZE": None, "OUTPUT": str(work_dir / "coverage_gaps.gpkg")})["OUTPUT"]
    progress("score", 77, "Scoring coverage gaps by uncovered community area")
    scored = processing.run("native:fieldcalculator", {"INPUT": gaps, "FIELD_NAME": "coverage_gap_m2", "FIELD_TYPE": 0, "FIELD_LENGTH": 20, "FIELD_PRECISION": 2, "NEW_FIELD": True, "FORMULA": "$area", "OUTPUT": str(work_dir / "scored_gaps.gpkg")})["OUTPUT"]
    progress("candidate-generation", 86, "Generating candidate station points from coverage gaps")
    candidates = processing.run("native:centroids", {"INPUT": scored, "ALL_PARTS": False, "OUTPUT": str(work_dir / "candidates.gpkg")})["OUTPUT"]
    ranked = processing.run("native:addautoincrementalfield", {"INPUT": candidates, "FIELD_NAME": "rank", "START": 1, "MODULUS": 0, "GROUP_FIELDS": [], "SORT_EXPRESSION": '"coverage_gap_m2"', "SORT_ASCENDING": False, "SORT_NULLS_FIRST": False, "OUTPUT": str(work_dir / "ranked_candidates.gpkg")})["OUTPUT"]
    progress("export", 94, "Exporting QGIS display layers as WGS84 GeoJSON")
    output_path = Path(message.get("outputPath") or data_dir.parent / "exports" / "fire_station_candidates.geojson"); output_path.parent.mkdir(parents=True, exist_ok=True)
    output_dir = output_path.parent
    # Each item is a direct QGIS output: no geometry is altered in the frontend.
    map_layers = [
        export_map_layer(stations_projected, "fire_stations", "Existing fire stations", "stations", output_dir, work_dir),
        export_map_layer(coverage, "fire_station_coverage", "Existing 5 km coverage", "coverage", output_dir, work_dir),
        export_map_layer(scored, "coverage_gaps", "Communities outside coverage", "gaps", output_dir, work_dir),
        export_map_layer(ranked, "fire_station_candidates", "Ranked fire station candidates", "candidates", output_dir, work_dir),
    ]
    candidate_layer = map_layers[-1]
    if output_path != Path(candidate_layer["outputPath"]):
        output_path.write_text(candidate_layer["geojson"], encoding="utf-8")
    feature_count = candidate_layer["featureCount"]; geojson = candidate_layer["geojson"]
    progress("complete", 100, f"Generated {feature_count} ranked candidate locations")
    return {"layerName": "Ranked fire station candidates", "geojson": geojson, "outputPath": str(output_path), "featureCount": feature_count, "elapsedMs": round((time.perf_counter() - started) * 1000), "warnings": ["Coverage is a 5 km straight-line proxy, not a road-network travel-time model."], "mapLayers": map_layers}

def handle(message: dict[str, Any]) -> None:
    try:
        action = message.get("action")
        if action == "bootstrap": emit("result", {"datasets": bootstrap(data_directory(message))})
        elif action == "fire-station-analysis": emit("result", run_fire_station_analysis(message))
        else: emit("error", {"message": "Unsupported worker action."})
    except Exception as error: emit("error", {"message": str(error)})

if __name__ == "__main__":
    for line in sys.stdin:
        if line.strip(): handle(json.loads(line))
