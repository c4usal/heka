import { circleRing, densifyLine, formatCoordinate, haversineMeters, pointToSegmentMeters, type LonLat } from "./geoMath";
import type { MapLayer } from "../types/workspace";
import { resolveEarthIntent, type EarthSkill } from "./questionIntent";

function minDistanceToPoints(point: LonLat, others: LonLat[]): number {
  if (others.length === 0) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (const other of others) best = Math.min(best, haversineMeters(point, other));
  return best;
}

function minDistanceToSegments(point: LonLat, segments: Array<{ a: LonLat; b: LonLat }>): number {
  if (segments.length === 0) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (const segment of segments) best = Math.min(best, pointToSegmentMeters(point, segment.a, segment.b));
  return best;
}

type GeoJsonGeometry = { type: string; coordinates: unknown };
type GeoJsonFeature = { type: "Feature"; properties?: Record<string, unknown> | null; geometry?: GeoJsonGeometry | null };
type FeatureCollection = { type: "FeatureCollection"; features: GeoJsonFeature[] };

export type RankedCandidate = {
  rank: number;
  score: number;
  lon: number;
  lat: number;
  label: string;
  rationale: string;
  roadName?: string;
  gapMeters?: number;
};

export type LocalAnalysisResult = {
  skill: EarthSkill;
  title: string;
  answer: string;
  candidates: RankedCandidate[];
  candidateLayer: MapLayer;
  coverageLayer?: MapLayer;
  notes: string[];
  confidence?: number;
};

type LayerBundle = {
  roads: FeatureCollection[];
  waterways: FeatureCollection[];
  bridges: FeatureCollection[];
  buildings: FeatureCollection[];
  facilities: FeatureCollection[];
  secondaryFacilities: FeatureCollection[];
};

const ROAD_WEIGHT: Record<string, number> = {
  motorway: 1.3, trunk: 1.25, primary: 1.2, secondary: 1.1, tertiary: 1.05, residential: 1, unclassified: 0.95,
};

function parseCollection(geojson: string): FeatureCollection | null {
  try {
    const parsed = JSON.parse(geojson) as FeatureCollection;
    if (parsed?.type !== "FeatureCollection" || !Array.isArray(parsed.features)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function asLonLat(pair: unknown): LonLat | null {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const lon = Number(pair[0]);
  const lat = Number(pair[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}

function lineCoords(geometry: GeoJsonGeometry | null | undefined): LonLat[][] {
  if (!geometry) return [];
  if (geometry.type === "LineString") {
    const line = (geometry.coordinates as unknown[]).map(asLonLat).filter((point): point is LonLat => !!point);
    return line.length >= 2 ? [line] : [];
  }
  if (geometry.type === "MultiLineString") {
    return (geometry.coordinates as unknown[]).map((segment) => (segment as unknown[]).map(asLonLat).filter((point): point is LonLat => !!point)).filter((line) => line.length >= 2);
  }
  if (geometry.type === "Polygon") {
    const ring = ((geometry.coordinates as unknown[])[0] as unknown[] | undefined)?.map(asLonLat).filter((point): point is LonLat => !!point) ?? [];
    return ring.length >= 2 ? [ring] : [];
  }
  return [];
}

function pointCoords(feature: GeoJsonFeature): LonLat | null {
  const geometry = feature.geometry;
  if (!geometry) return null;
  if (geometry.type === "Point") return asLonLat(geometry.coordinates);
  if (geometry.type === "MultiPoint") return asLonLat((geometry.coordinates as unknown[])[0]);
  const lines = lineCoords(geometry);
  if (lines[0]?.length) return lines[0][Math.floor(lines[0].length / 2)];
  return null;
}

function propertyName(feature: GeoJsonFeature): string | undefined {
  const name = feature.properties?.name ?? feature.properties?.ref ?? feature.properties?.highway;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

function roadClassWeight(feature: GeoJsonFeature): number {
  const highway = feature.properties?.highway;
  if (typeof highway !== "string") return 1;
  return ROAD_WEIGHT[highway] ?? 1;
}

function collectPoints(collections: FeatureCollection[]): LonLat[] {
  const points: LonLat[] = [];
  for (const collection of collections) {
    for (const feature of collection.features) {
      const point = pointCoords(feature);
      if (point) points.push(point);
      for (const line of lineCoords(feature.geometry)) {
        for (const vertex of densifyLine(line, 60)) points.push(vertex);
      }
    }
  }
  return points;
}

function collectSegments(collections: FeatureCollection[]): Array<{ a: LonLat; b: LonLat }> {
  const segments: Array<{ a: LonLat; b: LonLat }> = [];
  for (const collection of collections) {
    for (const feature of collection.features) {
      for (const line of lineCoords(feature.geometry)) {
        for (let index = 1; index < line.length; index += 1) segments.push({ a: line[index - 1], b: line[index] });
      }
    }
  }
  return segments;
}

function nonMaxSuppression(candidates: Array<Omit<RankedCandidate, "rank">>, spacingMeters: number, limit: number): RankedCandidate[] {
  const selected: RankedCandidate[] = [];
  for (const candidate of candidates.sort((left, right) => right.score - left.score)) {
    if (selected.some((kept) => haversineMeters({ lon: kept.lon, lat: kept.lat }, { lon: candidate.lon, lat: candidate.lat }) < spacingMeters)) continue;
    selected.push({ ...candidate, rank: selected.length + 1 });
    if (selected.length >= limit) break;
  }
  return selected;
}

function toCandidateLayer(candidates: RankedCandidate[], skill: string): MapLayer {
  const features = candidates.map((candidate) => ({
    type: "Feature" as const,
    properties: {
      rank: candidate.rank,
      score: Number(candidate.score.toFixed(2)),
      label: `#${candidate.rank}`,
      name: candidate.label,
      rationale: candidate.rationale,
      roadName: candidate.roadName ?? null,
      gapMeters: candidate.gapMeters ?? null,
      pinSize: candidate.rank === 1 ? 34 : candidate.rank === 2 ? 26 : 20,
      isTopPick: candidate.rank === 1,
      skill,
    },
    geometry: { type: "Point" as const, coordinates: [candidate.lon, candidate.lat] },
  }));
  return {
    id: `ranked-candidates-${skill}`,
    name: "Ranked candidates",
    kind: "candidates",
    geojson: JSON.stringify({ type: "FeatureCollection", features }),
    featureCount: features.length,
    outputPath: `memory://${skill}-candidates`,
  };
}

function toCoverageLayer(centers: LonLat[], radiusMeters: number, label: string): MapLayer {
  const features = centers.map((center, index) => ({
    type: "Feature" as const,
    properties: { name: `${label} ${radiusMeters}m coverage`, radiusMeters, facilityIndex: index + 1 },
    geometry: { type: "Polygon" as const, coordinates: [circleRing(center, radiusMeters)] },
  }));
  return {
    id: `coverage-rings-${radiusMeters}`,
    name: `${radiusMeters / 1000} km service rings`,
    kind: "coverage",
    geojson: JSON.stringify({ type: "FeatureCollection", features }),
    featureCount: features.length,
    outputPath: `memory://coverage-${radiusMeters}`,
  };
}

function sampleRoadPoints(bundle: LayerBundle, stepMeters = 180): LonLat[] {
  const samples: LonLat[] = [];
  for (const collection of bundle.roads) {
    for (const feature of collection.features) {
      for (const line of lineCoords(feature.geometry)) {
        for (const point of densifyLine(line, stepMeters)) samples.push(point);
      }
    }
  }
  return samples;
}

function coverageShare(samples: LonLat[], centers: LonLat[], radiusMeters: number): number {
  if (samples.length === 0) return 0;
  let covered = 0;
  for (const sample of samples) {
    if (minDistanceToPoints(sample, centers) <= radiusMeters) covered += 1;
  }
  return covered / samples.length;
}

function rankGapSites(bundle: LayerBundle, facilityPoints: LonLat[], radiusMeters: number, theme: string, limit: number): RankedCandidate[] {
  const drafts: Array<Omit<RankedCandidate, "rank">> = [];
  for (const collection of bundle.roads) {
    for (const feature of collection.features) {
      const weight = roadClassWeight(feature);
      const roadName = propertyName(feature);
      for (const line of lineCoords(feature.geometry)) {
        for (const sample of densifyLine(line, 160)) {
          const facilityMeters = minDistanceToPoints(sample, facilityPoints);
          if (facilityMeters < Math.max(600, radiusMeters * 0.3)) continue;
          drafts.push({
            score: weight * Math.min(facilityMeters, radiusMeters * 4),
            lon: sample.lon, lat: sample.lat,
            label: roadName ? `Gap along ${roadName}` : "Underserved arterial",
            roadName,
            gapMeters: facilityMeters,
            rationale: `About ${Math.round(facilityMeters)} m from the nearest mapped ${theme}.`,
          });
        }
      }
    }
  }
  return nonMaxSuppression(drafts, Math.max(500, radiusMeters * 0.25), limit);
}

/** Typical capital costs (CAD millions) for open-data demo scenarios — not a bid estimate. */
const COST_M: Record<string, number> = {
  "fire station": 14.8,
  hospital: 120,
  charger: 0.18,
  park: 4.2,
  "transit hub": 28,
  shelter: 6.5,
  facility: 15,
};

function personsPerArterialSample(_placeName?: string): number {
  // Generic arterial-sample → people proxy. Not city-tuned — works anywhere OSM has roads.
  return 75;
}

function formatDecisionBrief(input: {
  placeName?: string;
  recommendation: string;
  site: RankedCandidate;
  improvementPct: number;
  populationGained: number;
  costMillion: number;
  confidence: number;
  loaded: string[];
  budgetMillion?: number;
  runnersUp?: string;
}): string {
  const budgetLine = input.budgetMillion != null
    ? `Budget screen: $${input.budgetMillion}M — this pick fits with ~$${(input.budgetMillion - input.costMillion).toFixed(1)}M remaining.`
    : "";
  return [
    `Analyzing emergency / coverage options${input.placeName ? ` for ${input.placeName}` : ""}…`,
    "",
    ...input.loaded.map((line) => `Loading ${line}…`),
    "Running coverage simulation…",
    "Evaluating scenarios…",
    "",
    "Recommendation:",
    "",
    `${input.recommendation}`,
    `Site: ${formatCoordinate({ lon: input.site.lon, lat: input.site.lat })} (${input.site.label})`,
    "",
    `Expected coverage improvement: ${input.improvementPct.toFixed(0)}%`,
    `Population additionally covered (arterial proxy): ${input.populationGained.toLocaleString()}`,
    `Estimated cost: $${input.costMillion.toFixed(1)}M`,
    `Confidence: ${input.confidence >= 75 ? "High" : input.confidence >= 55 ? "Medium" : "Low"} (${input.confidence}%)`,
    budgetLine,
    input.runnersUp ? `\nAlso considered: ${input.runnersUp}` : "",
    "",
    "OpenStreetMap arterial coverage screen — not a full CAD/dispatch model. The map pin is the investment to look at.",
  ].filter((line) => line !== undefined).join("\n").replace(/\n{3,}/g, "\n\n");
}

function conversationalFacilityAnswer(
  placeName: string | undefined,
  facilityLabel: string,
  candidates: RankedCandidate[],
  radiusMeters: number,
  facilityCount: number,
  theme: string,
  topN = 3,
  presentation?: string,
): string {
  if (candidates.length === 0) {
    return `I pulled open map layers${placeName ? ` around ${placeName}` : ""} for ${facilityLabel}, but I could not pin a clear coverage gap yet.`;
  }
  const shown = candidates.slice(0, topN);
  const top = shown[0];
  if (presentation === "decision_brief") {
    const costKey = Object.keys(COST_M).find((key) => theme.includes(key) || facilityLabel.includes(key)) ?? "facility";
    const cost = (COST_M[costKey] ?? 15) * (topN > 1 && /charger|bike/i.test(theme + facilityLabel) ? topN : 1);
    const gapKm = Math.round((top.gapMeters ?? 0) / 100) / 10;
    return [
      `Recommendation:`,
      "",
      topN > 1
        ? `Build ${topN} new ${facilityLabel} starting at the ranked pins — #1 is the strongest accessibility gain.`
        : `Build one new ${theme.replace(/s$/, "")} here.`,
      `Site #1: ${formatCoordinate({ lon: top.lon, lat: top.lat })} — ${top.label}`,
      "",
      `Existing ${facilityLabel} mapped: ${facilityCount}`,
      `Service ring used: ${radiusMeters / 1000} km`,
      `Gap to nearest existing: ~${gapKm} km`,
      `Estimated capital (order-of-magnitude): $${cost.toFixed(1)}M`,
      `Confidence: Medium (OSM coverage screen)`,
      "",
      shown.length > 1
        ? `Next sites: ${shown.slice(1).map((c) => `#${c.rank} ${formatCoordinate({ lon: c.lon, lat: c.lat })}`).join("; ")}.`
        : "",
      `Teal discs = current coverage proxy. Red #1 TOP = the investment to defend in the room.`,
    ].filter(Boolean).join("\n");
  }
  const runners = candidates.slice(1, 3).map((item) => `#${item.rank} near ${item.roadName ?? "an arterial"} (~${Math.round((item.gapMeters ?? 0) / 100) / 10} km out)`).join("; ");
  const themePhrase = /s$|space|hub|corridor/i.test(theme) ? theme : `${theme}s`;
  return [
    `For ${themePhrase}${placeName ? ` in ${placeName}` : ""}, I mapped ${facilityCount} existing ${facilityLabel} and drew ${radiusMeters / 1000} km straight-line service rings — teal discs are the coverage proxy.`,
    `Strongest open-data gap: #1 ${top.label} at ${formatCoordinate({ lon: top.lon, lat: top.lat })} — about ${Math.round(top.gapMeters ?? 0)} m from the nearest mapped ${theme}. That oversized red pin is the pick.`,
    runners ? `Next: ${runners}.` : "",
    `OSM screen for the demo, not a full planning study — but the map is real ${facilityLabel} on real arterials.`,
  ].filter(Boolean).join(" ");
}

function conversationalBridgeAnswer(placeName: string | undefined, candidates: RankedCandidate[]): string {
  if (candidates.length === 0) {
    return `I found the place${placeName ? ` (${placeName})` : ""}, but I could not yet separate a clean set of river approaches from existing crossings.`;
  }
  const top = candidates[0];
  const more = candidates.slice(1, 3).map((item) => `#${item.rank} ${item.label}`).join(", ");
  return [
    `For a new bridge${placeName ? ` in ${placeName}` : ""}, I stacked arterials against the river corridor and existing crossings.`,
    `My top pick is #1 — ${top.label} at ${formatCoordinate({ lon: top.lon, lat: top.lat })}. ${top.rationale}`,
    more ? `Next contenders: ${more}.` : "",
    `Pink lines are existing bridges, blue is the river, and the oversized pins are ranked approaches — #1 is the loud one.`,
  ].filter(Boolean).join(" ");
}

function analyzeBridgeSiting(bundle: LayerBundle, placeName?: string): LocalAnalysisResult | null {
  if (bundle.roads.length === 0 || bundle.waterways.length === 0) return null;
  const waterSegments = collectSegments(bundle.waterways);
  const bridgePoints = collectPoints(bundle.bridges);
  if (waterSegments.length === 0) return null;

  type Draft = Omit<RankedCandidate, "rank"> & { riverMeters: number; bridgeMeters: number; weight: number };
  const drafts: Draft[] = [];
  for (const collection of bundle.roads) {
    for (const feature of collection.features) {
      const bridgeTag = feature.properties?.bridge;
      if (typeof bridgeTag === "string" && bridgeTag !== "no") continue;
      const weight = roadClassWeight(feature);
      const roadName = propertyName(feature);
      for (const line of lineCoords(feature.geometry)) {
        for (const sample of densifyLine(line, 100)) {
          const riverMeters = minDistanceToSegments(sample, waterSegments);
          const bridgeMeters = minDistanceToPoints(sample, bridgePoints);
          drafts.push({
            score: 0, lon: sample.lon, lat: sample.lat,
            label: roadName ? `${roadName} approach` : "Arterial river approach",
            roadName, rationale: "", riverMeters,
            bridgeMeters: Number.isFinite(bridgeMeters) ? bridgeMeters : 5000,
            gapMeters: Number.isFinite(bridgeMeters) ? bridgeMeters : 5000,
            weight,
          });
        }
      }
    }
  }
  if (drafts.length === 0) return null;
  const sortedByRiver = [...drafts].sort((a, b) => a.riverMeters - b.riverMeters);
  const proximityCap = Math.max(220, sortedByRiver[Math.min(sortedByRiver.length - 1, Math.floor(sortedByRiver.length * 0.18))]?.riverMeters ?? 220);
  const nearRiver = drafts.filter((draft) => draft.riverMeters <= Math.min(proximityCap, 900) && draft.bridgeMeters >= 250);
  const pool = nearRiver.length >= 8 ? nearRiver : drafts.filter((draft) => draft.riverMeters <= 1200 && draft.bridgeMeters >= 150);
  const working = pool.length > 0 ? pool : sortedByRiver.slice(0, Math.min(120, sortedByRiver.length));
  for (const draft of working) {
    draft.score = draft.weight * (1 / Math.max(draft.riverMeters, 40)) * Math.min(draft.bridgeMeters, 3000) * (draft.riverMeters < 300 ? 1.25 : 1);
    draft.rationale = `${Math.round(draft.riverMeters)} m from the river and ${Math.round(draft.bridgeMeters)} m from the nearest existing bridge.`;
  }
  const candidates = nonMaxSuppression(working, 400, 6);
  return {
    skill: "bridge_siting",
    title: "Bridge siting contenders",
    answer: conversationalBridgeAnswer(placeName, candidates),
    candidates,
    candidateLayer: toCandidateLayer(candidates, "bridge_siting"),
    coverageLayer: bridgePoints.length ? toCoverageLayer(bridgePoints.slice(0, 40), 450, "Existing bridge") : undefined,
    notes: [`Bridge siting pool=${working.length} → ${candidates.length} ranked sites.`],
  };
}

function analyzeDualCoverage(
  bundle: LayerBundle,
  placeName: string | undefined,
  demandLabel: string,
  supplyLabel: string,
  radiusMeters: number,
  theme: string,
): LocalAnalysisResult | null {
  const demand = collectPoints(bundle.facilities);
  const supply = collectPoints(bundle.secondaryFacilities);
  if (demand.length === 0 || supply.length === 0) return null;
  const drafts: Array<Omit<RankedCandidate, "rank">> = [];
  for (const point of demand) {
    const gap = minDistanceToPoints(point, supply);
    if (gap < radiusMeters) continue;
    drafts.push({
      score: gap,
      lon: point.lon,
      lat: point.lat,
      label: `${demandLabel} beyond ${radiusMeters / 1000} km`,
      gapMeters: gap,
      rationale: `${Math.round(gap)} m from the nearest ${supplyLabel.replace(/s$/, "")}.`,
    });
  }
  const candidates = nonMaxSuppression(drafts, Math.max(400, radiusMeters * 0.15), 8);
  return {
    skill: "facility_gap",
    title: `${demandLabel} vs ${supplyLabel}`,
    answer: candidates.length
      ? `For ${theme}${placeName ? ` in ${placeName}` : ""}, I mapped ${demand.length} ${demandLabel} against ${supply.length} ${supplyLabel}. ${candidates.length} ${demandLabel} sit farther than ${radiusMeters / 1000} km from the nearest ${supplyLabel.replace(/s$/, "")} — #1 is worst at ${formatCoordinate({ lon: candidates[0].lon, lat: candidates[0].lat })} (~${Math.round(candidates[0].gapMeters ?? 0)} m). Teal rings are ${supplyLabel} coverage; red pins flag the outliers.`
      : `I mapped ${demand.length} ${demandLabel} and ${supply.length} ${supplyLabel}${placeName ? ` around ${placeName}` : ""} — none exceeded the ${radiusMeters / 1000} km gap threshold on this OSM cut.`,
    candidates,
    candidateLayer: toCandidateLayer(candidates, "dual_coverage"),
    coverageLayer: toCoverageLayer(supply, radiusMeters, supplyLabel),
    notes: [`Dual coverage: ${demand.length} ${demandLabel} vs ${supply.length} ${supplyLabel}; ${candidates.length} beyond ${radiusMeters}m.`],
  };
}

function analyzeFacilityGap(
  bundle: LayerBundle,
  placeName?: string,
  facilityLabel = "hospitals",
  radiusMeters = 2500,
  theme = "facility",
  topN = 3,
  presentation?: string,
): LocalAnalysisResult | null {
  if (bundle.roads.length === 0 || bundle.facilities.length === 0) return null;
  const facilityPoints = collectPoints(bundle.facilities);
  if (facilityPoints.length === 0) return null;
  const candidates = rankGapSites(bundle, facilityPoints, radiusMeters, theme, Math.max(6, topN));
  return {
    skill: "facility_gap",
    title: `${facilityLabel} gap screen`,
    answer: conversationalFacilityAnswer(placeName, facilityLabel, candidates, radiusMeters, facilityPoints.length, theme, topN, presentation),
    candidates: candidates.slice(0, Math.max(topN, 3)),
    candidateLayer: toCandidateLayer(candidates.slice(0, Math.max(topN, 3)), "facility_gap"),
    coverageLayer: toCoverageLayer(facilityPoints, radiusMeters, facilityLabel),
    notes: [`Facility-gap (${theme}) → ${candidates.length} ranked sites; ${facilityPoints.length} ${facilityLabel} @ ${radiusMeters}m rings.`],
    confidence: candidates.length ? 68 : 40,
  };
}

function analyzeInvestmentDecision(
  bundle: LayerBundle,
  placeName: string | undefined,
  budgetMillion: number,
  fireRadius = 3000,
  hospitalRadius = 2500,
): LocalAnalysisResult | null {
  if (bundle.roads.length === 0) return null;
  const firePoints = collectPoints(bundle.facilities);
  const hospitalPoints = collectPoints(bundle.secondaryFacilities);
  if (firePoints.length === 0 && hospitalPoints.length === 0) return null;

  const samples = sampleRoadPoints(bundle, 200);
  if (samples.length < 20) return null;

  const scenarios: Array<{
    kind: "fire station" | "hospital";
    site: RankedCandidate;
    baseline: number;
    improved: number;
    costMillion: number;
  }> = [];

  if (firePoints.length > 0) {
    const fireSites = rankGapSites(bundle, firePoints, fireRadius, "fire station", 5);
    if (fireSites[0]) {
      const baseline = coverageShare(samples, firePoints, fireRadius);
      const improved = coverageShare(samples, [...firePoints, { lon: fireSites[0].lon, lat: fireSites[0].lat }], fireRadius);
      scenarios.push({ kind: "fire station", site: fireSites[0], baseline, improved, costMillion: COST_M["fire station"] });
    }
  }
  if (hospitalPoints.length > 0) {
    const hospitalSites = rankGapSites(bundle, hospitalPoints, hospitalRadius, "hospital", 5);
    if (hospitalSites[0]) {
      const baseline = coverageShare(samples, hospitalPoints, hospitalRadius);
      const improved = coverageShare(samples, [...hospitalPoints, { lon: hospitalSites[0].lon, lat: hospitalSites[0].lat }], hospitalRadius);
      scenarios.push({ kind: "hospital", site: hospitalSites[0], baseline, improved, costMillion: COST_M.hospital });
    }
  }
  if (scenarios.length === 0) return null;

  // Prefer investments that fit the budget and maximize coverage lift.
  const affordable = scenarios.filter((s) => s.costMillion <= budgetMillion * 1.05);
  const pool = affordable.length ? affordable : scenarios;
  pool.sort((a, b) => {
    const liftA = (a.improved - a.baseline) / Math.max(a.costMillion, 0.1);
    const liftB = (b.improved - b.baseline) / Math.max(b.costMillion, 0.1);
    return liftB - liftA;
  });
  const winner = pool[0];
  const improvementPct = Math.max(0, (winner.improved - winner.baseline) * 100);
  const newlyCoveredShare = Math.max(0, winner.improved - winner.baseline);
  const populationGained = Math.round(newlyCoveredShare * samples.length * personsPerArterialSample(placeName));
  const confidence = Math.min(88, 55 + Math.round(improvementPct) + (affordable.length ? 8 : 0));

  const runnersUp = scenarios
    .filter((s) => s !== winner)
    .map((s) => `${s.kind} (+${((s.improved - s.baseline) * 100).toFixed(0)}% cov, $${s.costMillion}M)`)
    .join("; ");

  const loaded = [
    firePoints.length ? `fire stations (${firePoints.length})` : "",
    hospitalPoints.length ? `hospitals (${hospitalPoints.length})` : "",
    `roads (${samples.length} arterial samples)`,
    "coverage rings",
  ].filter(Boolean);

  return {
    skill: "investment_decision",
    title: "Emergency investment recommendation",
    answer: formatDecisionBrief({
      placeName,
      recommendation: `Build one ${winner.kind} here.`,
      site: winner.site,
      improvementPct,
      populationGained,
      costMillion: winner.costMillion,
      confidence,
      loaded,
      budgetMillion,
      runnersUp: runnersUp || undefined,
    }),
    candidates: [winner.site, ...scenarios.filter((s) => s !== winner).map((s) => s.site)].map((site, index) => ({ ...site, rank: index + 1 })),
    candidateLayer: toCandidateLayer(
      [winner.site, ...scenarios.filter((s) => s !== winner).map((s) => s.site)].map((site, index) => ({ ...site, rank: index + 1 })),
      "investment_decision",
    ),
    coverageLayer: toCoverageLayer(
      winner.kind === "fire station" ? firePoints : hospitalPoints,
      winner.kind === "fire station" ? fireRadius : hospitalRadius,
      winner.kind === "fire station" ? "fire stations" : "hospitals",
    ),
    notes: [
      `Investment decision: winner=${winner.kind} lift=${improvementPct.toFixed(1)}% pop≈${populationGained} cost=$${winner.costMillion}M`,
      `Baseline cov=${(winner.baseline * 100).toFixed(1)}% → ${(winner.improved * 100).toFixed(1)}%`,
    ],
    confidence,
  };
}

function analyzeFeatureMap(bundle: LayerBundle, placeName: string | undefined, facilityLabel: string, theme: string): LocalAnalysisResult | null {
  const points = collectPoints(bundle.facilities);
  if (points.length === 0) return null;
  const candidates = points.slice(0, 12).map((point, index) => ({
    rank: index + 1,
    score: 1000 - index,
    lon: point.lon,
    lat: point.lat,
    label: `${theme} ${index + 1}`,
    rationale: `Mapped ${theme} from OpenStreetMap.`,
    gapMeters: 0,
  }));
  return {
    skill: "feature_map",
    title: `Mapped ${facilityLabel}`,
    answer: `Here is what OpenStreetMap currently shows for ${facilityLabel}${placeName ? ` around ${placeName}` : ""}: ${points.length} features plotted. Pins mark the mapped sites — inventory, not a “build here” ranking.`,
    candidates,
    candidateLayer: toCandidateLayer(candidates, "feature_map"),
    coverageLayer: toCoverageLayer(points, 800, facilityLabel),
    notes: [`Feature map: ${points.length} ${facilityLabel}.`],
  };
}

function analyzeDevelopmentGap(bundle: LayerBundle, placeName?: string): LocalAnalysisResult | null {
  if (bundle.roads.length === 0 || bundle.buildings.length === 0) return null;
  const buildingPoints = collectPoints(bundle.buildings);
  const drafts: Array<Omit<RankedCandidate, "rank">> = [];
  for (const collection of bundle.roads) {
    for (const feature of collection.features) {
      const weight = roadClassWeight(feature);
      const roadName = propertyName(feature);
      for (const line of lineCoords(feature.geometry)) {
        for (const sample of densifyLine(line, 150)) {
          const buildingMeters = minDistanceToPoints(sample, buildingPoints);
          if (buildingMeters < 120) continue;
          drafts.push({
            score: weight * Math.min(buildingMeters, 1500),
            lon: sample.lon, lat: sample.lat,
            label: roadName ? `Open frontage on ${roadName}` : "Open frontage",
            roadName, gapMeters: buildingMeters,
            rationale: `Mapped buildings are about ${Math.round(buildingMeters)} m away.`,
          });
        }
      }
    }
  }
  const candidates = nonMaxSuppression(drafts, 400, 6);
  return {
    skill: "development_gap",
    title: "Development frontage gaps",
    answer: candidates.length
      ? `Around ${placeName ?? "this place"}, the most open arterial frontages I can defend from OSM buildings are led by #1 ${candidates[0].label} (${formatCoordinate({ lon: candidates[0].lon, lat: candidates[0].lat })}). Pins mark the ranked spots.`
      : `I mapped roads and buildings${placeName ? ` around ${placeName}` : ""} but could not rank open frontages.`,
    candidates,
    candidateLayer: toCandidateLayer(candidates, "development_gap"),
    notes: [`Development-gap → ${candidates.length} ranked sites.`],
  };
}

export function detectAnalysisIntent(question: string, _objective?: string): EarthSkill {
  return resolveEarthIntent(question).skill;
}

export function detectFacilityAmenity(question: string, _objective?: string): { amenity: string; label: string; extra?: string[]; radius: number; theme: string } {
  const intent = resolveEarthIntent(question);
  return {
    amenity: intent.osmAmenity ?? "hospital",
    label: intent.label,
    extra: intent.osmExtraFilters,
    radius: intent.serviceRadiusMeters,
    theme: intent.theme,
  };
}

export function requiredOpenDataSkills(intent: ReturnType<typeof detectAnalysisIntent>): Array<{ name: string; kind: string }> {
  if (intent === "bridge_siting") return [{ name: "Road network", kind: "roads" }, { name: "Rivers and waterways", kind: "other" }, { name: "Existing bridges", kind: "other" }];
  if (intent === "facility_gap") return [{ name: "Road network", kind: "roads" }, { name: "Mapped facilities", kind: "facilities" }];
  if (intent === "development_gap") return [{ name: "Road network", kind: "roads" }, { name: "Building footprints", kind: "other" }];
  return [{ name: "Road network", kind: "roads" }];
}

export function bundleLayers(layers: Array<{ name: string; kind: string; geojson: string }>): LayerBundle {
  const bundle: LayerBundle = { roads: [], waterways: [], bridges: [], buildings: [], facilities: [], secondaryFacilities: [] };
  for (const layer of layers) {
    const collection = parseCollection(layer.geojson);
    if (!collection) continue;
    const key = `${layer.name} ${layer.kind}`.toLowerCase();
    if (/(bridge|crossing)/.test(key) || layer.kind === "bridges") bundle.bridges.push(collection);
    else if (/(river|waterway|stream|canal|creek|water)/.test(key) || layer.kind === "waterways") bundle.waterways.push(collection);
    else if (/(building|footprint)/.test(key)) bundle.buildings.push(collection);
    else if (/(road|street|highway|corridor)/.test(key) || layer.kind === "roads") bundle.roads.push(collection);
    else if (layer.kind === "secondary" || /secondary/.test(key)) bundle.secondaryFacilities.push(collection);
    else if (/(hospital|school|station|facility|charger|clinic|library|police|amenity|park|green|volcano|airport|transit|pharmacy|supermarket|wetland|bike)/.test(key) || layer.kind === "stations" || layer.kind === "facilities") bundle.facilities.push(collection);
  }
  return bundle;
}

export function runLocalOpenDataAnalysis(input: {
  question: string;
  placeName?: string;
  layers: Array<{ name: string; kind: string; geojson: string }>;
  /** Locked from resolveEarthIntent(question) — never re-inferred from planner prose. */
  skill: EarthSkill;
  facilityLabel?: string;
  facilityLabelSecondary?: string;
  theme?: string;
  serviceRadiusMeters?: number;
  topN?: number;
  budgetMillion?: number;
  presentation?: "decision_brief" | "gap" | "inventory";
}): LocalAnalysisResult {
  const intent = input.skill;
  const bundle = bundleLayers(input.layers);
  const facilityLabel = input.facilityLabel ?? "facilities";
  const theme = input.theme ?? "facility";
  const radius = input.serviceRadiusMeters ?? 2500;
  const topN = input.topN ?? 3;
  const notes = [
    `Intent skill: ${intent} (question-locked)`,
    `Layers: roads=${bundle.roads.reduce((n, c) => n + c.features.length, 0)}, waterways=${bundle.waterways.reduce((n, c) => n + c.features.length, 0)}, bridges=${bundle.bridges.reduce((n, c) => n + c.features.length, 0)}, facilities=${bundle.facilities.reduce((n, c) => n + c.features.length, 0)}, secondary=${bundle.secondaryFacilities.reduce((n, c) => n + c.features.length, 0)}, buildings=${bundle.buildings.reduce((n, c) => n + c.features.length, 0)}`,
  ];

  let result: LocalAnalysisResult | null = null;
  if (intent === "investment_decision") {
    result = analyzeInvestmentDecision(bundle, input.placeName, input.budgetMillion ?? 50, 3000, 2500);
  } else if (intent === "bridge_siting") result = analyzeBridgeSiting(bundle, input.placeName);
  else if (intent === "facility_gap" && bundle.secondaryFacilities.length > 0) {
    result = analyzeDualCoverage(bundle, input.placeName, facilityLabel, input.facilityLabelSecondary ?? "secondary facilities", radius, theme);
  }
  else if (intent === "facility_gap") {
    result = analyzeFacilityGap(bundle, input.placeName, facilityLabel, radius, theme, topN, input.presentation);
  }
  else if (intent === "feature_map") result = analyzeFeatureMap(bundle, input.placeName, facilityLabel, theme);
  else if (intent === "development_gap") result = analyzeDevelopmentGap(bundle, input.placeName);
  // No cross-skill fallbacks: a hospital question must never become a bridge answer.

  if (result) {
    result.notes = [...notes, ...result.notes];
    return result;
  }
  return {
    skill: intent === "inventory" ? "inventory" : intent,
    title: "Could not finish this screen",
    answer: `You asked about ${theme}${input.placeName ? ` in ${input.placeName}` : ""}. I geocoded the place but still need overlapping open-map layers for this skill. Retry once — Overpass mirrors can be busy; Heka will shrink the search window and fetch again.`,
    candidates: [],
    candidateLayer: toCandidateLayer([], intent),
    notes: [...notes, "Skill refused to pivot to an unrelated analysis."],
    confidence: 25,
  };
}
