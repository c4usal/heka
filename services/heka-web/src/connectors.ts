/**
 * Evidence-first connectors. The agent asks "what do I need?" then picks a connector.
 * Unavailable connectors return honest status — never fake data.
 */

export type ConnectorStatus = "available" | "needs_key" | "unavailable" | "proxy_only";

export type EarthConnector = {
  id: string;
  label: string;
  evidence: string[];
  status: ConnectorStatus;
  tool?: string;
  detail: string;
};

export function listConnectors(env: { WORLDPOP_API_KEY?: string; ORS_API_KEY?: string }): EarthConnector[] {
  return [
    {
      id: "nominatim",
      label: "Nominatim geocoder",
      evidence: ["place", "location", "bbox"],
      status: "available",
      tool: "geocode_place",
      detail: "OpenStreetMap Nominatim place lookup.",
    },
    {
      id: "openstreetmap",
      label: "OpenStreetMap / Overpass",
      evidence: ["roads", "facilities", "waterways", "bridges", "buildings", "landuse", "parks"],
      status: "available",
      tool: "osm_features",
      detail: "Mapped infrastructure and amenities via Overpass.",
    },
    {
      id: "open_research",
      label: "Open web research",
      evidence: ["context", "history", "reports", "explanations"],
      status: "available",
      tool: "research_place",
      detail: "DuckDuckGo Instant Answer + Wikipedia summaries.",
    },
    {
      id: "building_demand_proxy",
      label: "Building-density demand proxy",
      evidence: ["population", "demand"],
      status: "proxy_only",
      tool: "sample_demand",
      detail: "Relative demand from OSM buildings — not census.",
    },
    {
      id: "worldpop",
      label: "WorldPop population",
      evidence: ["population", "demographics"],
      status: env.WORLDPOP_API_KEY ? "available" : "needs_key",
      tool: "sample_demand",
      detail: env.WORLDPOP_API_KEY ? "WorldPop stats API key present." : "Set WORLDPOP_API_KEY to enable gridded population totals.",
    },
    {
      id: "openrouteservice",
      label: "OpenRouteService accessibility",
      evidence: ["travel_time", "isochrones", "accessibility"],
      status: env.ORS_API_KEY ? "available" : "needs_key",
      tool: "route_access",
      detail: env.ORS_API_KEY ? "ORS key present for drive-time isochrones." : "Set ORS_API_KEY for network travel-time; otherwise arterial class proxy.",
    },
    {
      id: "flood_official",
      label: "Official flood / inundation",
      evidence: ["flood", "sea_level", "inundation"],
      status: "unavailable",
      detail: "No national flood connector wired yet. Waterway proximity is a labeled proxy only.",
    },
    {
      id: "tornado_climatology",
      label: "Tornado / severe weather climatology",
      evidence: ["tornado", "severe_weather"],
      status: "unavailable",
      detail: "Scaffold only — returns unavailable until a national hazard connector is added.",
    },
    {
      id: "nasa_firms",
      label: "NASA FIRMS wildfire",
      evidence: ["wildfire", "fire_hotspots"],
      status: "unavailable",
      detail: "Scaffold only — not yet connected.",
    },
    {
      id: "sentinel_hub",
      label: "Satellite change (Sentinel / EO)",
      evidence: ["satellite", "urban_expansion", "forest_loss"],
      status: "unavailable",
      detail: "No temporal EO pipeline yet. Do not invent change detection.",
    },
  ];
}

export function planEvidenceNeeds(question: string, env: { WORLDPOP_API_KEY?: string; ORS_API_KEY?: string }) {
  const q = question.toLowerCase();
  const needs: Array<{ evidence: string; reason: string; connectors: string[] }> = [];
  const push = (evidence: string, reason: string, connectors: string[]) => {
    needs.push({ evidence, reason, connectors });
  };

  push("place", "Must geocode before mapping.", ["nominatim"]);

  if (/\b(hospital|school|fire|park|charger|transit|bridge|road|build|site|where|underserved|accessibility)\b/.test(q)) {
    push("mapped_infrastructure", "Question involves physical facilities or networks.", ["openstreetmap"]);
  }
  if (/\b(population|demand|people|density|underserved|coverage|growth)\b/.test(q)) {
    push("population_or_demand", "Question asks who is affected or where demand is.", ["worldpop", "building_demand_proxy"]);
  }
  if (/\b(flood|sea level|inundat|evacuat|drainage|rainfall)\b/.test(q)) {
    push("flood_or_water", "Question involves flood/water risk.", ["flood_official", "openstreetmap", "open_research"]);
  }
  if (/\b(travel|minute|isochrone|response time|drive|access)\b/.test(q)) {
    push("travel_time", "Question involves network accessibility.", ["openrouteservice", "openstreetmap"]);
  }
  if (/\b(wildfire|fire spread)\b/.test(q) && !/\bfire station\b/.test(q)) {
    push("wildfire", "Question involves wildfire hazard.", ["nasa_firms", "open_research"]);
  }
  if (/\b(tornado)\b/.test(q)) {
    push("tornado", "Question involves tornado likelihood.", ["tornado_climatology", "open_research"]);
  }
  if (/\b(satellite|2015|2025|forest loss|urban expansion|mining)\b/.test(q)) {
    push("satellite_change", "Question implies temporal EO analysis.", ["sentinel_hub", "openstreetmap", "open_research"]);
  }
  if (/\b(why|explain|history|report)\b/.test(q)) {
    push("context", "Explanatory question benefits from open research.", ["open_research"]);
  }

  const catalog = listConnectors(env);
  const plan = needs.map((need) => {
    const resolved = need.connectors.map((id) => {
      const connector = catalog.find((c) => c.id === id);
      return {
        connectorId: id,
        status: connector?.status ?? "unavailable",
        tool: connector?.tool,
        detail: connector?.detail ?? "Unknown connector",
      };
    });
    const usable = resolved.filter((r) => r.status === "available" || r.status === "proxy_only");
    return {
      evidence: need.evidence,
      reason: need.reason,
      connectors: resolved,
      nextTools: usable.map((u) => u.tool).filter(Boolean),
      honestGap: usable.length === 0
        ? `No live connector for '${need.evidence}' — research + explicit limitation only.`
        : null,
    };
  });

  return {
    principle: "Decide what evidence is needed first, then pick connectors — do not jump straight to Overpass.",
    plan,
    catalog,
  };
}
