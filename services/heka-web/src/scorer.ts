import { circleRing, densifyLine, haversineMeters, minDistanceToPoints, minDistanceToSegments, normalize01 } from "./geo";
import type { EarthCandidate, EarthCriterion, EarthLayer, GeoFeature, LonLat } from "./types";

const ROAD_WEIGHT: Record<string, number> = {
  motorway: 1.3, trunk: 1.25, primary: 1.2, secondary: 1.1, tertiary: 1.05,
};

function lineCoords(geometry: GeoFeature["geometry"] | null | undefined): LonLat[][] {
  if (!geometry) return [];
  if (geometry.type === "LineString") {
    const line = (geometry.coordinates as number[][]).map(([lon, lat]) => ({ lon, lat })).filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));
    return line.length >= 2 ? [line] : [];
  }
  if (geometry.type === "MultiLineString") {
    return (geometry.coordinates as number[][][])
      .map((segment) => segment.map(([lon, lat]) => ({ lon, lat })).filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat)))
      .filter((line) => line.length >= 2);
  }
  if (geometry.type === "Polygon") {
    const ring = ((geometry.coordinates as number[][][])[0] ?? []).map(([lon, lat]) => ({ lon, lat })).filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));
    return ring.length >= 2 ? [ring] : [];
  }
  return [];
}

function pointCoords(feature: GeoFeature): LonLat | null {
  const g = feature.geometry;
  if (!g) return null;
  if (g.type === "Point") {
    const [lon, lat] = g.coordinates as number[];
    return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : null;
  }
  const lines = lineCoords(g);
  if (lines[0]?.length) return lines[0][Math.floor(lines[0].length / 2)];
  return null;
}

function collectPoints(features: GeoFeature[]): LonLat[] {
  const points: LonLat[] = [];
  for (const feature of features) {
    const p = pointCoords(feature);
    if (p) points.push(p);
  }
  return points;
}

function collectSegments(features: GeoFeature[]): Array<{ a: LonLat; b: LonLat }> {
  const segments: Array<{ a: LonLat; b: LonLat }> = [];
  for (const feature of features) {
    for (const line of lineCoords(feature.geometry)) {
      for (let i = 1; i < line.length; i += 1) segments.push({ a: line[i - 1], b: line[i] });
    }
  }
  return segments;
}

function roadWeight(feature: GeoFeature): number {
  const highway = feature.properties?.highway;
  if (typeof highway !== "string") return 1;
  return ROAD_WEIGHT[highway] ?? 1;
}

function roadClassLabel(feature: GeoFeature): string {
  const highway = feature.properties?.highway;
  return typeof highway === "string" ? highway : "arterial";
}

function nonMaxSuppression(candidates: EarthCandidate[], spacingMeters: number, limit: number): EarthCandidate[] {
  const selected: EarthCandidate[] = [];
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    if (selected.some((kept) => haversineMeters({ lon: kept.lon, lat: kept.lat }, { lon: candidate.lon, lat: candidate.lat }) < spacingMeters)) continue;
    selected.push({ ...candidate, rank: selected.length + 1, id: `site-${selected.length + 1}` });
    if (selected.length >= limit) break;
  }
  return selected;
}

export type ScoreSitesInput = {
  mode: "facility" | "bridge";
  roads: GeoFeature[];
  facilities?: GeoFeature[];
  waterways?: GeoFeature[];
  bridges?: GeoFeature[];
  buildings?: GeoFeature[];
  landuse?: GeoFeature[];
  /** Schools, shops, transit, clinics — community activity proxies (any facility type). */
  communityAnchors?: GeoFeature[];
  weights?: Partial<Record<"undersupply" | "demand" | "access" | "flood_risk" | "growth_proxy" | "suitability" | "activity" | "river_proximity" | "bridge_gap", number>>;
  topN?: number;
  serviceRadiusMeters?: number;
  themeLabel?: string;
};

export type ScoreSitesResult = {
  criteria: EarthCriterion[];
  candidates: EarthCandidate[];
  layers: EarthLayer[];
  limitations: string[];
  confidence: number;
  summary: string;
};

function defaultWeights(mode: "facility" | "bridge", custom?: ScoreSitesInput["weights"]) {
  if (mode === "bridge") {
    return {
      river_proximity: custom?.river_proximity ?? 0.35,
      bridge_gap: custom?.bridge_gap ?? 0.35,
      access: custom?.access ?? 0.2,
      demand: custom?.demand ?? 0.1,
    };
  }
  // Generic facility siting: coverage gap + catchment demand lead; arterial access is secondary.
  return {
    undersupply: custom?.undersupply ?? 0.32,
    demand: custom?.demand ?? 0.26,
    activity: custom?.activity ?? 0.14,
    access: custom?.access ?? 0.12,
    flood_risk: custom?.flood_risk ?? 0.08,
    growth_proxy: custom?.growth_proxy ?? 0.04,
    suitability: custom?.suitability ?? 0.04,
  };
}

function countNearby(point: LonLat, others: LonLat[], radiusMeters: number): number {
  let n = 0;
  for (const other of others) if (haversineMeters(point, other) <= radiusMeters) n += 1;
  return n;
}

function landusePenalty(point: LonLat, landuse: GeoFeature[]): number {
  let nearestBad = Number.POSITIVE_INFINITY;
  let nearestResidential = Number.POSITIVE_INFINITY;
  for (const feature of landuse) {
    const use = String(feature.properties?.landuse ?? "");
    const p = pointCoords(feature);
    if (!p) continue;
    const d = haversineMeters(point, p);
    if (/industrial|military|quarry|landfill|railway|brownfield/i.test(use)) {
      nearestBad = Math.min(nearestBad, d);
    }
    if (/residential/i.test(use)) {
      nearestResidential = Math.min(nearestResidential, d);
    }
  }
  let score = 1;
  if (Number.isFinite(nearestBad)) {
    if (nearestBad < 150) score = 0.15;
    else if (nearestBad < 400) score = 0.45;
    else score = 0.85;
  }
  // Slight preference for residential fabric (people live here).
  if (Number.isFinite(nearestResidential) && nearestResidential < 500) score = Math.min(1, score + 0.1);
  return score;
}

function weightedTopFactors(
  factors: Record<string, number>,
  weights: Record<string, number>,
): Array<[string, number]> {
  return Object.entries(factors)
    .map(([k, v]) => [k, (weights[k] ?? 0) * v] as [string, number])
    .sort((a, b) => b[1] - a[1]);
}

const FACTOR_EXPERT: Record<string, (theme: string) => string> = {
  undersupply: (theme) => `closes a larger gap in current ${theme} coverage`,
  demand: () => "sits nearer denser built fabric (higher estimated local demand)",
  activity: () => "is nearer community activity anchors (schools, shops, transit, services)",
  access: () => "keeps access via major arterials",
  flood_risk: () => "stays farther from mapped waterways (flood-proxy, not an official floodplain)",
  growth_proxy: () => "has more room on the urban fringe for future catchment growth",
  suitability: () => "avoids industrial / conflict land-use tags nearby",
  river_proximity: () => "is closer to the water crossing",
  bridge_gap: () => "is farther from existing bridges",
};

function factorPhrase(key: string, themeLabel: string): string {
  return (FACTOR_EXPERT[key] ?? (() => key.replace(/_/g, " ")))(themeLabel);
}

/** Expert-style recommendation for the top site — works for any facility theme. */
export function expertSiteNarrative(input: {
  placeName: string;
  themeLabel: string;
  candidate: EarthCandidate;
  weights: Record<string, number>;
  facilityCount: number;
  serviceRadiusMeters: number;
}): string {
  const { placeName, themeLabel, candidate, weights, facilityCount, serviceRadiusMeters } = input;
  const ranked = weightedTopFactors(candidate.factors, weights).slice(0, 3);
  const lead = ranked[0]?.[0];
  const metrics = candidate.metrics ?? {};
  const gapKm = typeof metrics.coverageGapMeters === "number"
    ? (metrics.coverageGapMeters / 1000).toFixed(1)
    : null;
  const buildings = metrics.buildingsWithin600m;
  const activity = metrics.activityAnchorsWithin800m;

  const whyBits = ranked.map(([k]) => factorPhrase(k, themeLabel));
  const gapLarge = gapKm != null && Number(gapKm) >= 1.2;
  const primaryWhy = (lead === "undersupply" || gapLarge)
    ? `This site closes a meaningful gap in current ${themeLabel} coverage${gapKm ? ` (~${gapKm} km from the nearest mapped facility)` : ""} while remaining on accessible arterials and serving areas with higher estimated demand.`
    : `This site offers the best balance among the open-data factors we can measure: ${whyBits.join("; ")}.`;

  const evidence: string[] = [];
  if (facilityCount) evidence.push(`${facilityCount} mapped ${themeLabel}${facilityCount === 1 ? "" : "s"} in the working area`);
  if (typeof buildings === "number") evidence.push(`${buildings} building centres within 600 m (demand proxy)`);
  if (typeof activity === "number") evidence.push(`${activity} community activity anchors within 800 m`);
  evidence.push(`${(serviceRadiusMeters / 1000).toFixed(1)} km straight-line service rings (not drive-time)`);

  return [
    `For ${placeName}, the #1 contender for a new ${themeLabel} is at ${candidate.lat.toFixed(5)}, ${candidate.lon.toFixed(5)}.`,
    "",
    primaryWhy,
    "",
    `Based on available open datasets (${evidence.join("; ")}), it ranks highest on unmet coverage vs catchment need — not merely because a road is nearby.`,
    "",
    "Honest limits: this is an open-map multi-criteria sketch (OSM + proxies), not a formal municipal siting study. Zoning, parcel ownership, capital cost, and official demographics are not in this run.",
  ].join("\n");
}

/** Multi-criteria site scoring — model sets weights; this tool computes. */
export function scoreSites(input: ScoreSitesInput): ScoreSitesResult {
  const topN = input.topN ?? 5;
  const radius = input.serviceRadiusMeters ?? (input.mode === "bridge" ? 450 : 2500);
  const weights = defaultWeights(input.mode, input.weights);
  const limitations: string[] = [];
  const buildingPoints = collectPoints(input.buildings ?? []);
  const facilityPoints = collectPoints(input.facilities ?? []);
  const bridgePoints = collectPoints(input.bridges ?? []);
  const carePoints = collectPoints(input.communityAnchors ?? []);
  const waterSegments = collectSegments(input.waterways ?? []);
  const landuse = input.landuse ?? [];
  const themeLabel = input.themeLabel ?? "facility";

  if (!buildingPoints.length) {
    limitations.push("Building footprints were thin — demand leans more on community activity anchors and arterial class.");
  }
  if (!carePoints.length && input.mode === "facility") {
    limitations.push("No community activity anchors mapped nearby — activity factor weakened.");
  }
  if (input.mode === "facility" && !facilityPoints.length) {
    limitations.push("No existing facilities mapped in the working area — ranking is greenfield (demand + activity + access).");
  }
  if (input.mode === "facility") {
    limitations.push("Flood risk is a waterway-proximity proxy, not an official floodplain map.");
    limitations.push("Demand uses OSM buildings + community activity anchors — not census demographics or capacity.");
    limitations.push("Coverage uses straight-line distance, not network travel time.");
  }

  type Draft = {
    lon: number;
    lat: number;
    accessRaw: number;
    undersupplyRaw: number;
    demandRaw: number;
    activityRaw: number;
    floodSafeRaw: number;
    growthRaw: number;
    suitabilityRaw: number;
    riverRaw: number;
    bridgeGapRaw: number;
    gapMeters: number;
    buildingsNear: number;
    activityNear: number;
    roadClass: string;
  };
  const drafts: Draft[] = [];

  for (const feature of input.roads) {
    if (drafts.length >= 280) break;
    const weight = roadWeight(feature);
    const bridgeTag = feature.properties?.bridge;
    if (typeof bridgeTag === "string" && bridgeTag !== "no") continue;
    for (const line of lineCoords(feature.geometry)) {
      if (drafts.length >= 280) break;
      for (const sample of densifyLine(line, input.mode === "bridge" ? 140 : 320)) {
        if (drafts.length >= 280) break;
        const facilityMeters = minDistanceToPoints(sample, facilityPoints);
        const buildingCount = countNearby(sample, buildingPoints, 600);
        const careCount = countNearby(sample, carePoints, 800);
        const waterMeters = minDistanceToSegments(sample, waterSegments);
        const bridgeMeters = minDistanceToPoints(sample, bridgePoints);

        if (input.mode === "facility") {
          // Skip points already deep inside coverage unless local demand is high.
          if (facilityPoints.length && facilityMeters < radius * 0.25 && buildingCount < 6 && careCount < 2) continue;
        } else if (waterSegments.length && waterMeters > 900) {
          continue;
        }

        // Prefer local arterials over freeways for most civic facilities.
        const highway = typeof feature.properties?.highway === "string" ? feature.properties.highway : "";
        const accessRaw = highway === "motorway" ? weight * 0.35 : highway === "trunk" ? weight * 0.7 : weight;
        const demandRaw = buildingCount * 1.0 + careCount * 3.5 + (buildingCount === 0 && careCount === 0 ? weight * 0.5 : 0);

        drafts.push({
          lon: sample.lon,
          lat: sample.lat,
          accessRaw,
          undersupplyRaw: Number.isFinite(facilityMeters) ? facilityMeters : 5000,
          demandRaw,
          activityRaw: careCount + (buildingCount > 8 ? 1 : 0),
          floodSafeRaw: Number.isFinite(waterMeters) ? waterMeters : 5000,
          growthRaw: buildingCount < 4 ? 1.2 : buildingCount < 12 ? 0.7 : 0.3,
          suitabilityRaw: landusePenalty(sample, landuse),
          riverRaw: Number.isFinite(waterMeters) ? 1 / Math.max(waterMeters, 40) : 0,
          bridgeGapRaw: Number.isFinite(bridgeMeters) ? bridgeMeters : 5000,
          gapMeters: Number.isFinite(facilityMeters) ? facilityMeters : 5000,
          buildingsNear: buildingCount,
          activityNear: careCount,
          roadClass: roadClassLabel(feature),
        });
      }
    }
  }

  if (!drafts.length) {
    return {
      criteria: Object.entries(weights).map(([id, weight]) => ({ id, label: id.replace(/_/g, " "), weight, source: "open-data proxy" })),
      candidates: [],
      layers: [],
      limitations: [...limitations, "Scorer found no candidate samples on arterials for this place."],
      confidence: 25,
      summary: "No ranked sites.",
    };
  }

  const accessN = normalize01(drafts.map((d) => d.accessRaw));
  const undersupplyN = normalize01(drafts.map((d) => d.undersupplyRaw));
  const demandN = normalize01(drafts.map((d) => d.demandRaw));
  const activityN = normalize01(drafts.map((d) => d.activityRaw));
  const floodSafeN = normalize01(drafts.map((d) => d.floodSafeRaw));
  const growthN = normalize01(drafts.map((d) => d.growthRaw));
  const suitabilityN = drafts.map((d) => d.suitabilityRaw);
  const riverN = normalize01(drafts.map((d) => d.riverRaw));
  const bridgeGapN = normalize01(drafts.map((d) => d.bridgeGapRaw));

  const scored: EarthCandidate[] = drafts.map((draft, index) => {
    const factors: Record<string, number> = {};
    let score = 0;
    if (input.mode === "bridge") {
      factors.river_proximity = riverN[index];
      factors.bridge_gap = bridgeGapN[index];
      factors.access = accessN[index];
      factors.demand = demandN[index];
      score =
        (weights.river_proximity ?? 0) * factors.river_proximity +
        (weights.bridge_gap ?? 0) * factors.bridge_gap +
        (weights.access ?? 0) * factors.access +
        (weights.demand ?? 0) * factors.demand;
    } else {
      factors.undersupply = undersupplyN[index];
      factors.demand = demandN[index];
      factors.activity = activityN[index];
      factors.access = accessN[index];
      factors.flood_risk = floodSafeN[index];
      factors.growth_proxy = growthN[index];
      factors.suitability = suitabilityN[index];
      score =
        (weights.undersupply ?? 0) * factors.undersupply +
        (weights.demand ?? 0) * factors.demand +
        (weights.activity ?? 0) * factors.activity +
        (weights.access ?? 0) * factors.access +
        (weights.flood_risk ?? 0) * factors.flood_risk +
        (weights.growth_proxy ?? 0) * factors.growth_proxy +
        (weights.suitability ?? 0) * factors.suitability;
    }

    const topWeighted = weightedTopFactors(factors, weights as unknown as Record<string, number>)
      .slice(0, 3)
      .map(([k]) => factorPhrase(k, themeLabel))
      .join("; ");

    return {
      id: `draft-${index}`,
      rank: 0,
      lon: draft.lon,
      lat: draft.lat,
      score,
      rationale: topWeighted || "Balanced multi-criteria site.",
      factors,
      metrics: {
        coverageGapMeters: Math.round(draft.gapMeters),
        buildingsWithin600m: draft.buildingsNear,
        activityAnchorsWithin800m: draft.activityNear,
        roadClass: draft.roadClass,
      },
    };
  });

  const candidates = nonMaxSuppression(scored, input.mode === "bridge" ? 400 : Math.max(500, radius * 0.2), topN);
  const criteria: EarthCriterion[] = Object.entries(weights).map(([id, weight]) => ({
    id,
    label: id.replace(/_/g, " "),
    weight,
    source:
      id === "demand" ? "OSM building density proxy"
        : id === "activity" ? "OSM community activity anchors"
          : id === "flood_risk" ? "waterway proximity proxy"
            : id === "access" ? "OSM arterial class"
              : id === "undersupply" ? "distance to existing facilities"
                : "OSM open map",
  }));

  const layers: EarthLayer[] = [];
  if (facilityPoints.length) {
    layers.push({
      id: "coverage-rings",
      name: `${(radius / 1000).toFixed(1)} km service rings`,
      kind: "coverage",
      featureCount: facilityPoints.length,
      geojson: JSON.stringify({
        type: "FeatureCollection",
        features: facilityPoints.map((center, i) => ({
          type: "Feature",
          properties: { name: `${input.themeLabel ?? "facility"} coverage`, facilityIndex: i + 1, radiusMeters: radius },
          geometry: { type: "Polygon", coordinates: [circleRing(center, radius)] },
        })),
      }),
    });
  }
  if (candidates.length) {
    layers.push({
      id: "ranked-candidates",
      name: "Ranked candidates",
      kind: "candidates",
      featureCount: candidates.length,
      geojson: JSON.stringify({
        type: "FeatureCollection",
        features: candidates.map((c) => ({
          type: "Feature",
          properties: {
            rank: c.rank,
            score: Number(c.score.toFixed(3)),
            label: `#${c.rank}`,
            name: c.rank === 1 ? `#1 TOP` : `#${c.rank}`,
            rationale: c.rationale,
            factors: c.factors,
            metrics: c.metrics,
            pinSize: c.rank === 1 ? 34 : c.rank === 2 ? 26 : 20,
            isTopPick: c.rank === 1,
          },
          geometry: { type: "Point", coordinates: [c.lon, c.lat] },
        })),
      }),
    });
  }

  const dataScore = Math.min(40, Math.round(
    (facilityPoints.length * 3 + buildingPoints.length / 15 + carePoints.length + (waterSegments.length ? 6 : 0) + (landuse.length ? 4 : 0)) / 2,
  ));
  const confidence = Math.min(86, 42 + dataScore + (candidates.length ? 8 : 0));
  const top = candidates[0];
  const summary = top
    ? `Top site #1 at ${top.lat.toFixed(5)}, ${top.lon.toFixed(5)} score=${top.score.toFixed(3)} — ${top.rationale}`
    : "No candidates ranked.";

  return { criteria, candidates, layers, limitations, confidence, summary };
}
