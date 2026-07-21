/** Parse common spatial uploads into GeoJSON FeatureCollections for the globe. */

import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../config/aiGateway";

type Feature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};

export type ImportResult =
  | { ok: true; name: string; geojson: string; featureCount: number; format: string }
  | { ok: false; message: string; comingSoon?: boolean };

function featureCollection(features: Feature[]): string {
  return JSON.stringify({ type: "FeatureCollection", features });
}

function basename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || filename;
}

function parseGeoJson(text: string, filename: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: `${filename} is not valid JSON.` };
  }
  const obj = parsed as { type?: string; features?: Feature[]; geometry?: unknown; properties?: Record<string, unknown>; coordinates?: unknown };
  let features: Feature[] = [];
  if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
    features = obj.features;
  } else if (obj.type === "Feature" && obj.geometry) {
    features = [{ type: "Feature", properties: obj.properties ?? {}, geometry: obj.geometry as Feature["geometry"] }];
  } else if (obj.type && obj.geometry) {
    features = [{ type: "Feature", properties: {}, geometry: { type: obj.type, coordinates: obj.coordinates } }];
  } else {
    return { ok: false, message: `${filename} is not a GeoJSON Feature or FeatureCollection.` };
  }
  return { ok: true, name: basename(filename), geojson: featureCollection(features), featureCount: features.length, format: "GeoJSON" };
}

function parseCsv(text: string, filename: string): ImportResult {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { ok: false, message: "CSV needs a header row and at least one data row." };
  const headers = lines[0].split(/[,;\t]/).map((h) => h.trim().replace(/^"|"$/g, ""));
  const lower = headers.map((h) => h.toLowerCase());
  const lonIdx = lower.findIndex((h) => ["lon", "lng", "long", "longitude", "x"].includes(h));
  const latIdx = lower.findIndex((h) => ["lat", "latitude", "y"].includes(h));
  if (lonIdx < 0 || latIdx < 0) {
    return { ok: false, message: "CSV needs longitude/latitude columns (lon/lat, lng/lat, or x/y)." };
  }
  const features: Feature[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    const lon = Number(cells[lonIdx]);
    const lat = Number(cells[latIdx]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const properties: Record<string, unknown> = {};
    headers.forEach((header, i) => { properties[header] = cells[i] ?? ""; });
    features.push({ type: "Feature", properties, geometry: { type: "Point", coordinates: [lon, lat] } });
  }
  if (!features.length) return { ok: false, message: "No valid coordinate rows found in CSV." };
  return { ok: true, name: basename(filename), geojson: featureCollection(features), featureCount: features.length, format: "CSV" };
}

function parseKml(text: string, filename: string): ImportResult {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) return { ok: false, message: `${filename} is not valid KML/XML.` };
  const features: Feature[] = [];
  const placemarks = Array.from(doc.getElementsByTagName("Placemark"));
  for (const place of placemarks) {
    const name = place.getElementsByTagName("name")[0]?.textContent ?? "Placemark";
    const point = place.getElementsByTagName("Point")[0];
    const line = place.getElementsByTagName("LineString")[0];
    const poly = place.getElementsByTagName("Polygon")[0];
    const readCoords = (node: Element | undefined) => {
      const raw = node?.getElementsByTagName("coordinates")[0]?.textContent ?? "";
      return raw.trim().split(/\s+/).map((tuple) => {
        const [lon, lat] = tuple.split(",").map(Number);
        return [lon, lat] as [number, number];
      }).filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
    };
    if (point) {
      const coords = readCoords(point);
      if (coords[0]) features.push({ type: "Feature", properties: { name }, geometry: { type: "Point", coordinates: coords[0] } });
    } else if (line) {
      const coords = readCoords(line);
      if (coords.length >= 2) features.push({ type: "Feature", properties: { name }, geometry: { type: "LineString", coordinates: coords } });
    } else if (poly) {
      const ring = poly.getElementsByTagName("LinearRing")[0];
      const coords = readCoords(ring);
      if (coords.length >= 3) features.push({ type: "Feature", properties: { name }, geometry: { type: "Polygon", coordinates: [coords] } });
    }
  }
  if (!features.length) return { ok: false, message: "No Placemarks with coordinates found in KML." };
  return { ok: true, name: basename(filename), geojson: featureCollection(features), featureCount: features.length, format: "KML" };
}

type ConvertResult = { name: string; geojson: string; featureCount: number; format: string };

async function convertViaQgis(file: File): Promise<ImportResult> {
  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const bytes = Array.from(buffer);
    const result = await invoke<ConvertResult>("convert_spatial_to_geojson", {
      request: { fileName: file.name, bytes },
    });
    return {
      ok: true,
      name: result.name || basename(file.name),
      geojson: result.geojson,
      featureCount: result.featureCount,
      format: result.format,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: message || "Could not convert this file. Install QGIS LTR (OSGeo4W) or convert to GeoJSON first.",
    };
  }
}

export async function importSpatialFile(file: File): Promise<ImportResult> {
  const name = file.name;
  const lower = name.toLowerCase();

  if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
    return parseGeoJson(await file.text(), name);
  }
  if (lower.endsWith(".kml")) {
    return parseKml(await file.text(), name);
  }
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
    return parseCsv(await file.text(), name);
  }
  if (lower.endsWith(".zip") || lower.endsWith(".shp") || lower.endsWith(".gpkg") || lower.endsWith(".geopackage")) {
    if (isTauriRuntime()) {
      return convertViaQgis(file);
    }
    return {
      ok: false,
      comingSoon: true,
      message: lower.includes("gpkg")
        ? "GeoPackage: convert to GeoJSON for the web demo. Desktop Heka opens .gpkg via QGIS."
        : "Shapefile: on the web demo, convert to GeoJSON first (mapshaper.org or QGIS). Full Shapefile import ships with the desktop install.",
    };
  }
  if (lower.endsWith(".tif") || lower.endsWith(".tiff") || lower.endsWith(".geotiff")) {
    return {
      ok: false,
      comingSoon: true,
      message: isTauriRuntime()
        ? "GeoTIFF raster preview is not ready yet — export a vector layer (GeoJSON) or use QGIS alongside Heka."
        : "GeoTIFF: raster preview is coming soon. For the web demo, use a vector export (GeoJSON) or the desktop IDE.",
    };
  }
  if (lower.endsWith(".kmz")) {
    return {
      ok: false,
      comingSoon: true,
      message: "KMZ: unzip and import the .kml, or export GeoJSON.",
    };
  }

  return {
    ok: false,
    message: `Unsupported format (${name}). Try GeoJSON, KML, CSV${isTauriRuntime() ? ", Shapefile, or GeoPackage" : ""}.`,
  };
}

export const IMPORT_ACCEPT = ".geojson,.json,.kml,.csv,.tsv,.zip,.shp,.gpkg,.tif,.tiff,.kmz";
