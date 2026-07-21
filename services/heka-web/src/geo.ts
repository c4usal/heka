import type { LonLat } from "./types";

const EARTH_M = 6_371_000;

export function haversineMeters(a: LonLat, b: LonLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function densifyLine(points: LonLat[], stepMeters: number): LonLat[] {
  if (points.length < 2) return points;
  const out: LonLat[] = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dist = haversineMeters(a, b);
    const steps = Math.max(1, Math.floor(dist / stepMeters));
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      out.push({ lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t });
    }
  }
  return out;
}

export function pointToSegmentMeters(point: LonLat, a: LonLat, b: LonLat): number {
  const toM = (p: LonLat, origin: LonLat) => {
    const latM = (Math.PI * EARTH_M) / 180;
    const lonM = latM * Math.cos((origin.lat * Math.PI) / 180);
    return { x: (p.lon - origin.lon) * lonM, y: (p.lat - origin.lat) * latM };
  };
  const p = toM(point, point);
  const aa = toM(a, point);
  const bb = toM(b, point);
  const abx = bb.x - aa.x;
  const aby = bb.y - aa.y;
  const ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-9) return Math.hypot(aa.x - p.x, aa.y - p.y);
  const t = Math.max(0, Math.min(1, ((p.x - aa.x) * abx + (p.y - aa.y) * aby) / ab2));
  return Math.hypot(aa.x + t * abx - p.x, aa.y + t * aby - p.y);
}

export function minDistanceToPoints(point: LonLat, others: LonLat[]): number {
  if (!others.length) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (const other of others) best = Math.min(best, haversineMeters(point, other));
  return best;
}

export function minDistanceToSegments(point: LonLat, segments: Array<{ a: LonLat; b: LonLat }>): number {
  if (!segments.length) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (const segment of segments) best = Math.min(best, pointToSegmentMeters(point, segment.a, segment.b));
  return best;
}

export function normalize01(values: number[], invert = false): number[] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return values.map(() => 0);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max - min < 1e-9) return values.map(() => 0.5);
  return values.map((v) => {
    if (!Number.isFinite(v)) return 0;
    const n = (v - min) / (max - min);
    return invert ? 1 - n : n;
  });
}

export function circleRing(center: LonLat, radiusMeters: number, steps = 48): number[][] {
  const coords: number[][] = [];
  const latRad = (center.lat * Math.PI) / 180;
  const dLat = radiusMeters / EARTH_M;
  const dLon = radiusMeters / (EARTH_M * Math.cos(latRad));
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    coords.push([
      center.lon + (dLon * 180) / Math.PI * Math.cos(t),
      center.lat + (dLat * 180) / Math.PI * Math.sin(t),
    ]);
  }
  return coords;
}
