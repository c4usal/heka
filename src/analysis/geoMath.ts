/** Lightweight geographic helpers for local open-data screening (no turf). */

const EARTH_M = 6_371_000;

export type LonLat = { lon: number; lat: number };

export function haversineMeters(a: LonLat, b: LonLat): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function midpoint(a: LonLat, b: LonLat): LonLat {
  return { lon: (a.lon + b.lon) / 2, lat: (a.lat + b.lat) / 2 };
}

/** Approximate meters-per-degree at a latitude for local planar checks. */
export function metersPerDegree(lat: number): { lon: number; lat: number } {
  const latM = (Math.PI * EARTH_M) / 180;
  const lonM = latM * Math.cos((lat * Math.PI) / 180);
  return { lon: Math.max(lonM, 1e-6), lat: latM };
}

export function pointToSegmentMeters(point: LonLat, a: LonLat, b: LonLat): number {
  const scale = metersPerDegree(point.lat);
  const ax = (a.lon - point.lon) * scale.lon;
  const ay = (a.lat - point.lat) * scale.lat;
  const bx = (b.lon - point.lon) * scale.lon;
  const by = (b.lat - point.lat) * scale.lat;
  const abx = bx - ax;
  const aby = by - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-9) return Math.hypot(ax, ay);
  const t = Math.max(0, Math.min(1, (-ax * abx - ay * aby) / ab2));
  const px = ax + t * abx;
  const py = ay + t * aby;
  return Math.hypot(px, py);
}

export function densifyLine(points: LonLat[], stepMeters: number): LonLat[] {
  if (points.length < 2) return points.slice();
  const samples: LonLat[] = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = haversineMeters(start, end);
    const steps = Math.max(1, Math.ceil(length / stepMeters));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      samples.push({ lon: start.lon + (end.lon - start.lon) * t, lat: start.lat + (end.lat - start.lat) * t });
    }
  }
  return samples;
}

export function formatCoordinate(point: LonLat): string {
  const ns = point.lat >= 0 ? "N" : "S";
  const ew = point.lon >= 0 ? "E" : "W";
  return `${Math.abs(point.lat).toFixed(4)}°${ns}, ${Math.abs(point.lon).toFixed(4)}°${ew}`;
}

/** Approximate geodesic circle as a GeoJSON polygon ring (lon/lat degrees). */
export function circleRing(center: LonLat, radiusMeters: number, steps = 64): number[][] {
  const scale = metersPerDegree(center.lat);
  const ring: number[][] = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    const east = Math.cos(angle) * radiusMeters;
    const north = Math.sin(angle) * radiusMeters;
    ring.push([center.lon + east / scale.lon, center.lat + north / scale.lat]);
  }
  return ring;
}
