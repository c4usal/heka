/** OpenStreetMap / Nominatim helpers for the public Heka web API. */

const UA = "Heka Web/0.1 (https://github.com/c4usal/heka; spatial IDE for hackathon demos)";

const OVERPASS_ENDPOINTS = [
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

export type PlaceFocus = {
  displayName: string;
  lat: number;
  lon: number;
  south: number;
  north: number;
  west: number;
  east: number;
};

export type OsmDiscoveryResult = {
  sourceName: string;
  featureCount: number;
  detail: string;
  geojson: string;
  outputPath: string;
  place: PlaceFocus;
};

type LonLat = { lon: number; lat: number };
type Feature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};

function clampBbox(south: number, north: number, west: number, east: number, lat: number, lon: number): [number, number, number, number] {
  // ~0.22° ≈ 24 km — enough for mid-size cities; still Worker-safe for Overpass.
  const maxSpan = 0.22;
  const minHalf = 0.06; // always cover at least ~13 km across
  let s = south;
  let n = north;
  let w = west;
  let e = east;
  if (n - s > maxSpan || e - w > maxSpan) {
    const half = maxSpan / 2;
    s = lat - half;
    n = lat + half;
    w = lon - half;
    e = lon + half;
  }
  if (n - s < minHalf * 2) {
    s = lat - minHalf;
    n = lat + minHalf;
  }
  if (e - w < minHalf * 2) {
    w = lon - minHalf;
    e = lon + minHalf;
  }
  return [s, n, w, e];
}

function shrinkBbox(south: number, north: number, west: number, east: number, factor: number): [number, number, number, number] {
  const latC = (south + north) / 2;
  const lonC = (west + east) / 2;
  const halfLat = ((north - south) / 2) * factor;
  const halfLon = ((east - west) / 2) * factor;
  return [latC - halfLat, latC + halfLat, lonC - halfLon, lonC + halfLon];
}

export async function geocodeScope(geographicScope: string): Promise<PlaceFocus> {
  const key = geographicScope.toLowerCase().replace(/[^a-z\s]/g, " ").trim().split(/\s+/)[0] ?? "";
  const known = KNOWN_PLACES[key] ?? KNOWN_PLACES[geographicScope.toLowerCase().trim()];
  if (known) return { ...known };

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", geographicScope);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "3");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(url.toString(), { headers: { "User-Agent": UA }, signal: controller.signal });
    if (!response.ok) throw new Error(`Location lookup failed (${response.status}).`);
    const items = await response.json() as Array<{
      display_name?: string;
      lat?: string;
      lon?: string;
      boundingbox?: string[];
      type?: string;
      class?: string;
    }>;
    if (!items.length) throw new Error("Heka could not locate the requested geographic scope.");
    const item = items.find((candidate) => {
      const kind = candidate.type ?? "";
      const klass = candidate.class ?? "";
      return ["city", "town", "municipality", "suburb", "neighbourhood", "administrative"].includes(kind) || klass === "place" || klass === "boundary";
    }) ?? items[0];
    const bounding = item.boundingbox;
    if (!bounding || bounding.length < 4) throw new Error("Invalid location bounds.");
    const south = Number(bounding[0]);
    const north = Number(bounding[1]);
    const west = Number(bounding[2]);
    const east = Number(bounding[3]);
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    if (![south, north, west, east, lat, lon].every(Number.isFinite)) throw new Error("Invalid place coordinates.");
    const [s, n, w, e] = clampBbox(south, north, west, east, lat, lon);
    return {
      displayName: item.display_name ?? geographicScope,
      lat,
      lon,
      south: s,
      north: n,
      west: w,
      east: e,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function overpassOne(
  endpoint: string,
  query: string,
  timeoutMs: number,
): Promise<{ elements?: unknown[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "User-Agent": UA, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: query }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Overpass ${endpoint} returned ${response.status}.`);
    const payload = await response.json() as { elements?: unknown[]; remark?: string };
    if (!payload.elements?.length) {
      throw new Error(payload.remark ? `Overpass incomplete: ${payload.remark}` : `Overpass empty from ${endpoint}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

/** Race two mirrors — first non-empty wins (not sequential 10s+10s). */
async function overpassQuery(query: string, timeoutMs = 8000): Promise<{ elements?: unknown[] }> {
  const endpoints = OVERPASS_ENDPOINTS.slice(0, 2);
  try {
    return await Promise.any(endpoints.map((endpoint) => overpassOne(endpoint, query, timeoutMs)));
  } catch {
    throw new Error("OpenStreetMap search failed on every mirror.");
  }
}

/** Well-known cities — skip Nominatim RTT (~0.5–2s) on the hot path. */
const KNOWN_PLACES: Record<string, PlaceFocus> = {
  calgary: { displayName: "Calgary, Alberta, Canada", lat: 51.0447, lon: -114.0719, south: 50.9347, north: 51.1547, west: -114.1819, east: -113.9619 },
  edmonton: { displayName: "Edmonton, Alberta, Canada", lat: 53.5461, lon: -113.4938, south: 53.4361, north: 53.6561, west: -113.6038, east: -113.3838 },
  vancouver: { displayName: "Vancouver, British Columbia, Canada", lat: 49.2827, lon: -123.1207, south: 49.1727, north: 49.3927, west: -123.2307, east: -123.0107 },
  toronto: { displayName: "Toronto, Ontario, Canada", lat: 43.6532, lon: -79.3832, south: 43.5432, north: 43.7632, west: -79.4932, east: -79.2732 },
  ottawa: { displayName: "Ottawa, Ontario, Canada", lat: 45.4215, lon: -75.6972, south: 45.3115, north: 45.5315, west: -75.8072, east: -75.5872 },
  montreal: { displayName: "Montreal, Quebec, Canada", lat: 45.5017, lon: -73.5673, south: 45.3917, north: 45.6117, west: -73.6773, east: -73.4573 },
  winnipeg: { displayName: "Winnipeg, Manitoba, Canada", lat: 49.8951, lon: -97.1384, south: 49.7851, north: 50.0051, west: -97.2484, east: -97.0284 },
  lethbridge: { displayName: "Lethbridge, Alberta, Canada", lat: 49.6956, lon: -112.8451, south: 49.6056, north: 49.7856, west: -112.9551, east: -112.7351 },
  lagos: { displayName: "Lagos, Nigeria", lat: 6.5244, lon: 3.3792, south: 6.4144, north: 6.6344, west: 3.2692, east: 3.4892 },
  london: { displayName: "London, England, United Kingdom", lat: 51.5074, lon: -0.1278, south: 51.3974, north: 51.6174, west: -0.2378, east: -0.0178 },
};

function elementToFeature(element: Record<string, unknown>): Feature | null {
  const kind = element.type as string | undefined;
  const id = element.id as number | undefined;
  if (!kind || id == null) return null;
  const tags = (element.tags as Record<string, unknown> | undefined) ?? {};
  const properties = { ...tags, osm_type: kind, osm_id: id };

  if (kind === "node" || element.center) {
    const center = (element.center as { lon?: number; lat?: number } | undefined) ?? element;
    const lon = Number((center as { lon?: number }).lon);
    const lat = Number((center as { lat?: number }).lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return { type: "Feature", properties, geometry: { type: "Point", coordinates: [lon, lat] } };
  }

  const points = element.geometry as Array<{ lon?: number; lat?: number }> | undefined;
  if (!points?.length) return null;
  const coordinates: LonLat[] = [];
  for (const point of points) {
    const lon = Number(point.lon);
    const lat = Number(point.lat);
    if (Number.isFinite(lon) && Number.isFinite(lat)) coordinates.push({ lon, lat });
  }
  if (coordinates.length < 2) return null;
  const pairs = coordinates.map((point) => [point.lon, point.lat]);
  const closed = pairs.length >= 4 && pairs[0][0] === pairs[pairs.length - 1][0] && pairs[0][1] === pairs[pairs.length - 1][1];
  return {
    type: "Feature",
    properties,
    geometry: closed
      ? { type: "Polygon", coordinates: [pairs] }
      : { type: "LineString", coordinates: pairs },
  };
}

function parseFeatures(payload: { elements?: unknown[] }): Feature[] {
  return (payload.elements ?? [])
    .map((element) => elementToFeature(element as Record<string, unknown>))
    .filter((feature): feature is Feature => !!feature);
}

async function overpassWithRetries(
  south: number,
  north: number,
  west: number,
  east: number,
  build: (s: number, n: number, w: number, e: number) => string,
  options?: { attempts?: number; timeoutMs?: number },
): Promise<Feature[]> {
  let s = south;
  let n = north;
  let w = west;
  let e = east;
  const attempts = options?.attempts ?? 2;
  const timeoutMs = options?.timeoutMs ?? 12000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const features = parseFeatures(await overpassQuery(build(s, n, w, e), timeoutMs));
      if (features.length > 0) return features;
    } catch {
      /* shrink and retry */
    }
    if (attempt === attempts - 1) break;
    [s, n, w, e] = shrinkBbox(s, n, w, e, 0.7);
  }
  return [];
}

function toDiscovery(name: string, features: Feature[], place: PlaceFocus, detail: string): OsmDiscoveryResult {
  const geojson = JSON.stringify({ type: "FeatureCollection", features });
  return {
    sourceName: "OpenStreetMap / Overpass",
    featureCount: features.length,
    detail,
    geojson,
    outputPath: `memory://osm-${name}`,
    place,
  };
}

function osmFilter(name: string, kind?: string): string {
  const value = `${name} ${kind ?? ""}`.toLowerCase();
  if (/bridge|crossing/.test(value)) return '["bridge"]';
  if (/building|footprint/.test(value)) return '["building"]';
  if (/river|waterway|stream|canal|creek|coast|water/.test(value)) return '["waterway"~"river|canal|stream|tidal_channel|fairway"]';
  if (/road|street|highway|corridor/.test(value)) return '["highway"~"motorway|trunk|primary|secondary|tertiary"]';
  if (/hospital|clinic|medical/.test(value)) return '["amenity"~"hospital|clinic|doctors"]';
  if (/school|university|college/.test(value)) return '["amenity"~"school|university|college"]';
  if (/fire/.test(value)) return '["amenity"="fire_station"]';
  if (/charg|ev /.test(value)) return '["amenity"="charging_station"]';
  if (/park|green/.test(value)) return '["leisure"="park"]';
  if (/facility|amenity/.test(value)) return '["amenity"]';
  throw new Error("Unsupported OpenStreetMap dataset name for web acquisition.");
}

export async function discoverOsmDataset(datasetName: string, geographicScope: string, kind?: string): Promise<OsmDiscoveryResult> {
  const filter = osmFilter(datasetName, kind);
  const place = await geocodeScope(geographicScope);
  const out = filter.includes("building") ? "out center 700;" : "out geom 700;";
  const features = await overpassWithRetries(place.south, place.north, place.west, place.east, (s, n, w, e) =>
    `[out:json][timeout:45];(way${filter}(${s},${w},${n},${e});node${filter}(${s},${w},${n},${e}););${out}`);
  if (!features.length) throw new Error(`OpenStreetMap found no geometries for '${datasetName}' around ${place.displayName}.`);
  return toDiscovery(datasetName, features, place, `Imported ${features.length} features around ${place.displayName}.`);
}

export async function discoverBridgeSitingContext(geographicScope: string) {
  const place = await geocodeScope(geographicScope);
  const roads = await overpassWithRetries(place.south, place.north, place.west, place.east, (s, n, w, e) =>
    `[out:json][timeout:45];way["highway"~"motorway|trunk|primary|secondary|tertiary"](${s},${w},${n},${e});out geom 700;`);
  let waterways = await overpassWithRetries(place.south, place.north, place.west, place.east, (s, n, w, e) =>
    `[out:json][timeout:45];(way["waterway"~"river|canal|stream|tidal_channel|fairway"](${s},${w},${n},${e});way["natural"="water"](${s},${w},${n},${e}););out geom 500;`);
  if (!waterways.length) {
    waterways = await overpassWithRetries(place.south, place.north, place.west, place.east, (s, n, w, e) =>
      `[out:json][timeout:45];(way["natural"="coastline"](${s},${w},${n},${e});way["waterway"](${s},${w},${n},${e}););out geom 400;`);
  }
  const bridges = await overpassWithRetries(place.south, place.north, place.west, place.east, (s, n, w, e) =>
    `[out:json][timeout:45];(way["bridge"](${s},${w},${n},${e});way["man_made"="bridge"](${s},${w},${n},${e});node["man_made"="bridge"](${s},${w},${n},${e});way["highway"]["bridge"~"yes|movable|cantilever|aqueduct"](${s},${w},${n},${e}););out geom 500;`);

  if (!roads.length) throw new Error(`OpenStreetMap returned no arterial roads around ${place.displayName}.`);
  if (!waterways.length) throw new Error(`OpenStreetMap returned no waterways/coastline around ${place.displayName}.`);

  const detail = `Bridge context around ${place.displayName}: ${roads.length} roads, ${waterways.length} water segments, ${bridges.length} bridges.`;
  return {
    place,
    roads: toDiscovery("bridge_roads", roads, place, detail),
    waterways: toDiscovery("bridge_waterways", waterways, place, detail),
    bridges: toDiscovery("bridge_bridges", bridges, place, detail),
    detail,
  };
}

function facilityParts(amenity: string, s: number, n: number, w: number, e: number): string {
  if (amenity === "park") {
    return `node["leisure"="park"](${s},${w},${n},${e});way["leisure"="park"](${s},${w},${n},${e});node["leisure"="playground"](${s},${w},${n},${e});way["natural"="wetland"](${s},${w},${n},${e})`;
  }
  if (amenity === "volcano") return `node["natural"="volcano"](${s},${w},${n},${e});way["natural"="volcano"](${s},${w},${n},${e})`;
  if (amenity === "airport") return `node["aeroway"="aerodrome"](${s},${w},${n},${e});way["aeroway"="aerodrome"](${s},${w},${n},${e})`;
  if (amenity.includes("|")) {
    let parts = `node["amenity"~"${amenity}"](${s},${w},${n},${e});way["amenity"~"${amenity}"](${s},${w},${n},${e})`;
    if (amenity.includes("bus_station")) parts += `;node["railway"="station"](${s},${w},${n},${e});way["railway"="station"](${s},${w},${n},${e})`;
    return parts;
  }
  let parts = `node["amenity"="${amenity}"](${s},${w},${n},${e});way["amenity"="${amenity}"](${s},${w},${n},${e})`;
  if (amenity === "hospital") {
    parts += `;node["healthcare"="hospital"](${s},${w},${n},${e});way["healthcare"="hospital"](${s},${w},${n},${e})`;
    parts += `;node["amenity"="clinic"]["emergency"="yes"](${s},${w},${n},${e})`;
  }
  if (amenity === "charging_station") {
    parts += `;node["charging_station"="yes"](${s},${w},${n},${e});node["amenity"="charging_station"](${s},${w},${n},${e});way["amenity"="charging_station"](${s},${w},${n},${e})`;
  }
  if (amenity === "library") {
    parts = `node["amenity"="library"](${s},${w},${n},${e});way["amenity"="library"](${s},${w},${n},${e})`;
  }
  return parts;
}

export async function discoverFacilityGapContext(geographicScope: string, amenity = "hospital") {
  const place = await geocodeScope(geographicScope);
  const roads = await overpassWithRetries(place.south, place.north, place.west, place.east, (s, n, w, e) =>
    `[out:json][timeout:45];way["highway"~"motorway|trunk|primary|secondary|tertiary"](${s},${w},${n},${e});out geom 700;`);
  const facilities = await overpassWithRetries(place.south, place.north, place.west, place.east, (s, n, w, e) =>
    `[out:json][timeout:45];(${facilityParts(amenity, s, n, w, e)};);out center;`);
  if (!roads.length) throw new Error(`OpenStreetMap returned no arterial roads around ${place.displayName}.`);
  if (!facilities.length) throw new Error(`OpenStreetMap returned no '${amenity}' features around ${place.displayName}.`);
  const detail = `Facility context around ${place.displayName}: ${roads.length} roads, ${facilities.length} ${amenity} features.`;
  return {
    place,
    roads: toDiscovery("facility_roads", roads, place, detail),
    facilities: toDiscovery("facility_facilities", facilities, place, detail),
    detail,
    amenity,
  };
}

export type OsmFeature = Feature;

export async function overpassFeaturesInBbox(
  place: PlaceFocus,
  build: (s: number, n: number, w: number, e: number) => string,
): Promise<Feature[]> {
  return overpassWithRetries(place.south, place.north, place.west, place.east, build);
}

/** Theme → Overpass query builder for the agent tool `osm_features`. */
export function themeQueryBuilder(theme: string): (s: number, n: number, w: number, e: number) => string {
  const t = theme.toLowerCase().trim();
  if (t === "roads" || t === "arterials") {
    return (s, n, w, e) => `[out:json][timeout:45];way["highway"~"motorway|trunk|primary|secondary|tertiary"](${s},${w},${n},${e});out geom 700;`;
  }
  if (t === "waterways" || t === "water" || t === "rivers") {
    return (s, n, w, e) => `[out:json][timeout:45];(way["waterway"~"river|canal|stream|tidal_channel|fairway"](${s},${w},${n},${e});way["natural"="water"](${s},${w},${n},${e}););out geom 500;`;
  }
  if (t === "bridges") {
    return (s, n, w, e) => `[out:json][timeout:45];(way["bridge"](${s},${w},${n},${e});way["man_made"="bridge"](${s},${w},${n},${e});way["highway"]["bridge"~"yes|movable|cantilever"](${s},${w},${n},${e}););out geom 500;`;
  }
  if (t === "buildings") {
    // Sample only — full footprints blow Worker time/memory; centers are enough for demand proxy.
    return (s, n, w, e) => `[out:json][timeout:20];way["building"](${s},${w},${n},${e});out center 400;`;
  }
  if (t === "landuse") {
    return (s, n, w, e) => `[out:json][timeout:45];way["landuse"](${s},${w},${n},${e});out geom 400;`;
  }
  if (t === "park" || t === "parks") {
    return (s, n, w, e) => `[out:json][timeout:45];(node["leisure"="park"](${s},${w},${n},${e});way["leisure"="park"](${s},${w},${n},${e}););out center;`;
  }
  if (t === "hospital" || t === "hospitals") {
    return (s, n, w, e) => `[out:json][timeout:45];(${facilityParts("hospital", s, n, w, e)};);out center;`;
  }
  if (t === "fire_station" || t === "fire") {
    return (s, n, w, e) => `[out:json][timeout:45];(${facilityParts("fire_station", s, n, w, e)};);out center;`;
  }
  if (t === "charging_station" || t === "ev" || t === "chargers") {
    return (s, n, w, e) => `[out:json][timeout:45];(${facilityParts("charging_station", s, n, w, e)};);out center;`;
  }
  if (t === "school" || t === "schools") {
    return (s, n, w, e) => `[out:json][timeout:45];(${facilityParts("school|university|college", s, n, w, e)};);out center;`;
  }
  if (t === "library" || t === "libraries") {
    return (s, n, w, e) => `[out:json][timeout:45];(${facilityParts("library", s, n, w, e)};);out center;`;
  }
  if (t === "transit" || t === "transit_hub") {
    return (s, n, w, e) => `[out:json][timeout:45];(${facilityParts("bus_station|ferry_terminal", s, n, w, e)};);out center;`;
  }
  return (s, n, w, e) => `[out:json][timeout:45];(${facilityParts(t, s, n, w, e)};);out center;`;
}

export async function fetchOsmTheme(place: PlaceFocus, theme: string): Promise<{ theme: string; featureCount: number; geojson: string; features: Feature[] }> {
  const features = await overpassFeaturesInBbox(place, themeQueryBuilder(theme));
  const cap = theme === "roads" ? 90 : theme === "buildings" ? 300 : theme === "waterways" ? 120 : 250;
  const clipped = features.slice(0, cap);
  return {
    theme,
    featureCount: clipped.length,
    geojson: JSON.stringify({ type: "FeatureCollection", features: clipped }),
    features: clipped,
  };
}

export type FacilitySitingBundle = {
  roads: Feature[];
  facilities: Feature[];
  buildings: Feature[];
  communityAnchors: Feature[];
  landuse: Feature[];
  waterways: Feature[];
};

/** Amenities that signal where people congregate — used for ANY facility siting. */
const COMMUNITY_ANCHOR_AMENITIES = new Set([
  "school", "kindergarten", "clinic", "doctors", "social_facility", "nursing_home",
  "marketplace", "supermarket", "convenience", "library", "community_centre",
  "bus_station", "ferry_terminal", "university", "college",
]);

function classifySitingFeature(feature: Feature, targetAmenity: string): keyof FacilitySitingBundle | null {
  const p = feature.properties ?? {};
  const amenity = String(p.amenity ?? "");
  const healthcare = String(p.healthcare ?? "");
  const highway = String(p.highway ?? "");
  const landuse = String(p.landuse ?? "");
  const waterway = String(p.waterway ?? "");
  const natural = String(p.natural ?? "");
  const building = p.building;
  const leisure = String(p.leisure ?? "");
  const target = targetAmenity.toLowerCase().replace(/s$/, ""); // hospitals → hospital (rough)
  const targetNorm = targetAmenity.toLowerCase();

  if (highway && /motorway|trunk|primary|secondary|tertiary/.test(highway)) return "roads";

  if (targetNorm === "hospital" || targetNorm === "hospitals") {
    if (amenity === "hospital" || healthcare === "hospital" || (amenity === "clinic" && String(p.emergency ?? "") === "yes")) {
      return "facilities";
    }
  } else if (targetNorm === "park" || targetNorm === "parks") {
    if (leisure === "park" || leisure === "playground") return "facilities";
  } else if (targetNorm === "charging_station" || targetNorm === "charger" || targetNorm === "chargers") {
    if (amenity === "charging_station" || p.charging_station === "yes") return "facilities";
  } else if (amenity === targetNorm || amenity === target) {
    return "facilities";
  } else if (targetNorm.includes("|") && targetNorm.split("|").includes(amenity)) {
    return "facilities";
  }

  if (COMMUNITY_ANCHOR_AMENITIES.has(amenity) && amenity !== targetNorm && !(targetNorm.startsWith("school") && /school|kindergarten|university|college/.test(amenity))) {
    if (!(targetNorm === "library" && amenity === "library")) return "communityAnchors";
  }
  if (building != null && building !== "no") return "buildings";
  if (/residential|industrial|military|quarry|landfill|brownfield|railway/.test(landuse)) return "landuse";
  if (waterway || natural === "water") return "waterways";
  return null;
}

function resolveAmenityParts(amenity: string, s: number, n: number, w: number, e: number): string {
  const a = amenity.toLowerCase();
  if (a === "hospital" || a === "hospitals") return facilityParts("hospital", s, n, w, e);
  if (a === "park" || a === "parks") return facilityParts("park", s, n, w, e);
  if (a === "fire" || a === "fire_station") return facilityParts("fire_station", s, n, w, e);
  if (a === "charger" || a === "chargers" || a === "charging_station" || a === "ev") return facilityParts("charging_station", s, n, w, e);
  if (a === "school" || a === "schools") return facilityParts("school|university|college", s, n, w, e);
  if (a === "library" || a === "libraries") return facilityParts("library", s, n, w, e);
  if (a === "clinic" || a === "clinics") return facilityParts("clinic", s, n, w, e);
  return facilityParts(amenity, s, n, w, e);
}

/**
 * Fast facility evidence: race Overpass mirrors, hard time budget.
 * Target: cold path under ~15–25s; warm Cache API path near-instant.
 */
export async function fetchFacilitySitingBundle(place: PlaceFocus, amenity = "hospital"): Promise<FacilitySitingBundle> {
  const empty = (): FacilitySitingBundle => ({
    roads: [], facilities: [], buildings: [], communityAnchors: [], landuse: [], waterways: [],
  });

  const classifyAll = (features: Feature[]): FacilitySitingBundle => {
    const bundle = empty();
    for (const feature of features) {
      const bucket = classifySitingFeature(feature, amenity);
      if (!bucket) continue;
      bundle[bucket].push(feature);
    }
    bundle.roads = bundle.roads.slice(0, 60);
    bundle.facilities = bundle.facilities.slice(0, 80);
    bundle.buildings = bundle.buildings.slice(0, 200);
    bundle.communityAnchors = bundle.communityAnchors.slice(0, 80);
    bundle.landuse = bundle.landuse.slice(0, 40);
    bundle.waterways = bundle.waterways.slice(0, 40);
    return bundle;
  };

  const amenityParts = resolveAmenityParts(amenity, place.south, place.north, place.west, place.east);
  // Single query: roads + facilities + light activity (no second widen round-trip).
  const coreQuery = `[out:json][timeout:6];
way["highway"~"trunk|primary|secondary|tertiary"](${place.south},${place.west},${place.north},${place.east});
out geom 40;
(
  ${amenityParts};
  node["amenity"~"school|clinic|library|bus_station"](${place.south},${place.west},${place.north},${place.east});
  way["amenity"~"school|clinic|library|bus_station"](${place.south},${place.west},${place.north},${place.east});
  way["building"](around:3500,${place.lat},${place.lon});
);
out center 180;`;

  let core: Feature[] = [];
  try {
    core = parseFeatures(await overpassQuery(coreQuery, 9000));
  } catch {
    try {
      // Lighter fallback — roads + amenity only.
      core = parseFeatures(await overpassQuery(
        `[out:json][timeout:5];
way["highway"~"primary|secondary|tertiary"](${place.south},${place.west},${place.north},${place.east});
out geom 30;
(${amenityParts};);
out center 80;`,
        7000,
      ));
    } catch {
      return empty();
    }
  }

  return classifyAll(core);
}
