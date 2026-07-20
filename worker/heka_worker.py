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
    "fire_stations": "https://data.calgary.ca/resource/cqsb-2hhg.geojson?$limit=5000",
    "communities": "https://data.calgary.ca/resource/surr-xmvs.geojson?$limit=5000",
}

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
            with urllib.request.urlopen(url, timeout=30) as response:
                target.write_bytes(response.read())
        paths[name] = str(target)
    return paths

def setup_qgis() -> None:
    prefix = os.environ.get("QGIS_PREFIX_PATH", r"C:\OSGeo4W\apps\qgis-ltr")
    from qgis.core import QgsApplication
    from qgis.analysis import QgsNativeAlgorithms
    QgsApplication.setPrefixPath(prefix, True)
    app = QgsApplication.instance() or QgsApplication([], False)
    app.initQgis()
    app.processingRegistry().addProvider(QgsNativeAlgorithms())

def run_fire_station_analysis(message: dict[str, Any]) -> dict[str, Any]:
    try:
        setup_qgis()
        import processing
        from qgis.core import QgsVectorLayer, QgsVectorFileWriter, QgsCoordinateTransformContext
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
    ranked = processing.run("native:fieldcalculator", {"INPUT": candidates, "FIELD_NAME": "rank", "FIELD_TYPE": 1, "FIELD_LENGTH": 5, "FIELD_PRECISION": 0, "NEW_FIELD": True, "FORMULA": 'row_number(order_by:="coverage_gap_m2", ascending:=false)', "OUTPUT": str(work_dir / "ranked_candidates.gpkg")})["OUTPUT"]
    progress("export", 94, "Exporting ranked candidate locations as GeoJSON")
    output_path = Path(message.get("outputPath") or data_dir.parent / "exports" / "fire_station_candidates.geojson"); output_path.parent.mkdir(parents=True, exist_ok=True)
    result_layer = QgsVectorLayer(ranked, "Ranked fire station candidates", "ogr")
    error_code, error_message, *_ = QgsVectorFileWriter.writeAsVectorFormatV3(result_layer, str(output_path), QgsCoordinateTransformContext(), QgsVectorFileWriter.SaveVectorOptions())
    if error_code != QgsVectorFileWriter.NoError: raise RuntimeError(f"QGIS could not export the result layer: {error_message}")
    feature_count = result_layer.featureCount(); geojson = output_path.read_text(encoding="utf-8")
    progress("complete", 100, f"Generated {feature_count} ranked candidate locations")
    return {"layerName": "Ranked fire station candidates", "geojson": geojson, "outputPath": str(output_path), "featureCount": feature_count, "elapsedMs": round((time.perf_counter() - started) * 1000), "warnings": ["Coverage is a 5 km straight-line proxy, not a road-network travel-time model."]}

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
