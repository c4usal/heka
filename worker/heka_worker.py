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
# This is an explicit local dataset registry, not an LLM prompt convention. The
# executor accepts a plan only when every requested logical dataset resolves to
# a real local layer that it can load through QGIS.
DATASET_REGISTRY = {
    "fire_stations": {
        "label": "Calgary fire station locations", "kind": "facilities", "geometry": "point",
        "terms": ("calgary fire station locations", "fire stations", "fire station", "emergency station", "emergency facility"),
    },
    "communities": {
        "label": "Calgary community districts", "kind": "boundaries", "geometry": "polygon",
        "terms": ("calgary community districts", "community districts", "communities", "community", "neighborhood", "neighbourhood", "district"),
    },
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

def resolve_local_plan(plan: dict[str, Any]) -> dict[str, Any]:
    """Validate the planner's declarative intent against Heka's local catalog.

    The model provides only intent and Spatial DSL. This resolver chooses no
    geometry and runs no model-supplied code; the QGIS adapter below owns every
    concrete operation.
    """
    if not isinstance(plan, dict) or not isinstance(plan.get("objective"), str):
        raise RuntimeError("Heka received an invalid spatial plan.")
    readiness = plan.get("executionReadiness")
    if readiness != "ready":
        raise RuntimeError(f"This plan is marked '{readiness or 'not ready'}' and cannot be executed until its data or clarification requirements are resolved.")
    requested = plan.get("requiredDatasets")
    if not isinstance(requested, list) or not requested:
        raise RuntimeError("The spatial plan did not identify any datasets.")
    resolved: set[str] = set()
    unsupported: list[str] = []
    for dataset in requested:
        name = dataset.get("name", "") if isinstance(dataset, dict) else str(dataset)
        normalized = name.lower()
        matches = [key for key, definition in DATASET_REGISTRY.items() if any(term in normalized for term in definition["terms"])]
        if matches: resolved.add(matches[0])
        else: unsupported.append(name)
    by_kind = {DATASET_REGISTRY[key]["kind"] for key in resolved}
    required_kinds = {"facilities", "boundaries"}
    if not required_kinds.issubset(by_kind):
        missing = ", ".join(kind for kind in sorted(required_kinds - by_kind))
        raise RuntimeError(f"This local runtime supports facility-coverage analysis and needs a loaded {missing} dataset.")
    if unsupported:
        raise RuntimeError(f"The plan requested datasets not loaded in this workspace: {', '.join(unsupported)}. Add them or ask a question using the Calgary station and community datasets.")
    workflow = plan.get("dsl", [])
    if not isinstance(workflow, list) or not workflow:
        raise RuntimeError("The validated plan has no Spatial DSL operations to execute.")
    supported = {"LoadDataset", "Buffer", "Overlay", "Difference", "Intersect", "Coverage", "Score", "Rank", "Visualize"}
    unknown = [str(step.get("operation")) for step in workflow if isinstance(step, dict) and step.get("operation") not in supported]
    if unknown:
        raise RuntimeError(f"This local runtime does not support these planned operations yet: {', '.join(unknown)}.")
    operations = {str(step.get("operation")) for step in workflow if isinstance(step, dict)}
    if not ({"Buffer", "Coverage"} & operations) or "Difference" not in operations or "Rank" not in operations:
        raise RuntimeError("The local facility-coverage runtime requires a coverage/buffer, difference, and ranking workflow.")
    distance = None
    for step in workflow:
        if not isinstance(step, dict) or step.get("operation") not in {"Buffer", "Coverage"}:
            continue
        for parameter in step.get("parameters", []):
            if isinstance(parameter, dict) and str(parameter.get("name", "")).lower() in {"distancemeters", "coverage_distancemeters", "distance"}:
                value = parameter.get("value")
                if isinstance(value, (int, float)) and not isinstance(value, bool): distance = float(value)
    if distance is None or not 250 <= distance <= 30000:
        raise RuntimeError("The Spatial DSL must specify a coverage distance between 250 and 30000 meters.")
    facility = next(key for key in resolved if DATASET_REGISTRY[key]["kind"] == "facilities")
    boundary = next(key for key in resolved if DATASET_REGISTRY[key]["kind"] == "boundaries")
    return {"objective": plan["objective"], "resolved": sorted(resolved), "facility": facility, "boundary": boundary, "coverageDistanceMeters": distance}

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

def run_spatial_plan(message: dict[str, Any]) -> dict[str, Any]:
    try:
        setup_qgis()
        from qgis.core import QgsVectorLayer
        import processing
    except Exception as error:
        raise RuntimeError(f"PyQGIS is unavailable. Install QGIS LTR and set QGIS_PREFIX_PATH if needed. ({error})") from error

    started = time.perf_counter(); progress("plan-validation", 8, "Validating the Spatial DSL against the local dataset catalog")
    plan_context = resolve_local_plan(message.get("plan", {})); data_dir = data_directory(message); paths = bootstrap(data_dir)
    missing = [name for name, path in paths.items() if not Path(path).exists()]
    if missing: raise RuntimeError(f"Required local datasets are missing: {', '.join(missing)}")
    work_dir = Path(tempfile.mkdtemp(prefix="heka-fire-stations-")); target_crs = "EPSG:3400"  # NAD83 / Alberta 10TM
    facility_id, boundary_id = plan_context["facility"], plan_context["boundary"]
    facility_name, boundary_name = DATASET_REGISTRY[facility_id]["label"], DATASET_REGISTRY[boundary_id]["label"]
    progress("dataset-load", 35, f"Loading datasets for: {plan_context['objective']}")
    stations = QgsVectorLayer(paths[facility_id], facility_name, "ogr")
    communities = QgsVectorLayer(paths[boundary_id], boundary_name, "ogr")
    if not stations.isValid() or not communities.isValid(): raise RuntimeError("QGIS could not read one or more local GeoJSON datasets.")
    progress("reproject", 45, "Reprojecting layers into Alberta 10TM for meter-based analysis")
    stations_projected = processing.run("native:reprojectlayer", {"INPUT": stations, "TARGET_CRS": target_crs, "OUTPUT": str(work_dir / "stations.gpkg")})["OUTPUT"]
    communities_projected = processing.run("native:reprojectlayer", {"INPUT": communities, "TARGET_CRS": target_crs, "OUTPUT": str(work_dir / "communities.gpkg")})["OUTPUT"]
    coverage_distance = plan_context["coverageDistanceMeters"]
    progress("buffer", 55, f"Generating {coverage_distance:g} m facility coverage areas")
    coverage = processing.run("native:buffer", {"INPUT": stations_projected, "DISTANCE": coverage_distance, "SEGMENTS": 16, "END_CAP_STYLE": 0, "JOIN_STYLE": 0, "MITER_LIMIT": 2, "DISSOLVE": True, "OUTPUT": str(work_dir / "coverage.gpkg")})["OUTPUT"]
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
        export_map_layer(stations_projected, facility_id, f"Existing {facility_name}", "stations", output_dir, work_dir),
        export_map_layer(coverage, "facility_coverage", f"Existing {coverage_distance:g} m coverage", "coverage", output_dir, work_dir),
        export_map_layer(scored, "coverage_gaps", f"{boundary_name} outside coverage", "gaps", output_dir, work_dir),
        export_map_layer(ranked, "facility_candidates", "Ranked facility candidates", "candidates", output_dir, work_dir),
    ]
    candidate_layer = map_layers[-1]
    if output_path != Path(candidate_layer["outputPath"]):
        output_path.write_text(candidate_layer["geojson"], encoding="utf-8")
    feature_count = candidate_layer["featureCount"]; geojson = candidate_layer["geojson"]
    progress("complete", 100, f"Generated {feature_count} ranked candidate locations")
    return {"layerName": "Ranked facility candidates", "geojson": geojson, "outputPath": str(output_path), "featureCount": feature_count, "elapsedMs": round((time.perf_counter() - started) * 1000), "warnings": ["Coverage is a straight-line distance proxy, not a road-network travel-time model."], "mapLayers": map_layers}

def handle(message: dict[str, Any]) -> None:
    try:
        action = message.get("action")
        if action == "bootstrap": emit("result", {"datasets": bootstrap(data_directory(message))})
        elif action == "execute-plan": emit("result", run_spatial_plan(message))
        else: emit("error", {"message": "Unsupported worker action."})
    except Exception as error: emit("error", {"message": str(error)})

if __name__ == "__main__":
    for line in sys.stdin:
        if line.strip(): handle(json.loads(line))
