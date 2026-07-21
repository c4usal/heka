/**
 * Question-first Earth intent. The user question wins — never the planner objective.
 * Routes wow-demo questions onto the best open-data skill Heka can run right now.
 */

export type EarthSkill =
  | "bridge_siting"
  | "facility_gap"
  | "development_gap"
  | "feature_map"
  | "research_map"
  | "inventory"
  | "investment_decision";

export type EarthIntent = {
  skill: EarthSkill;
  osmAmenity?: string;
  osmExtraFilters?: string[];
  /** Second amenity set for dual coverage or scenario compare. */
  osmAmenitySecondary?: string;
  label: string;
  labelSecondary?: string;
  serviceRadiusMeters: number;
  theme: string;
  /** How many ranked sites to emphasize (e.g. five EV chargers). */
  topN?: number;
  /** Budget in millions USD/CAD when the question names one. */
  budgetMillion?: number;
  /** Decision-support brief vs ordinary gap ranking. */
  presentation?: "decision_brief" | "gap" | "inventory";
  placeHints?: string[];
};

const FACILITY_PATTERNS: Array<{ match: RegExp; amenity: string; extra?: string[]; label: string; radius: number; theme: string }> = [
  { match: /\b(hospitals?|medical cent(?:er|re)s?|emergency rooms?)\b/i, amenity: "hospital", extra: ["[\"healthcare\"=\"hospital\"]"], label: "hospitals", radius: 2500, theme: "hospital" },
  { match: /\b(clinics?|doctors?|urgent care)\b/i, amenity: "clinic|doctors", label: "clinics", radius: 1500, theme: "clinic" },
  { match: /\b(schools?|universit(?:y|ies)|colleges?)\b/i, amenity: "school|university|college", label: "schools", radius: 1500, theme: "school" },
  { match: /\b(fire stations?|fire halls?)\b/i, amenity: "fire_station", label: "fire stations", radius: 3000, theme: "fire station" },
  { match: /\b(police stations?|\bpolice\b)\b/i, amenity: "police", label: "police stations", radius: 2500, theme: "police" },
  { match: /\b(libraries|library)\b/i, amenity: "library", label: "libraries", radius: 2000, theme: "library" },
  { match: /\b(ev chargers?|charging stations?|chargers?)\b/i, amenity: "charging_station", label: "EV chargers", radius: 1200, theme: "charger" },
  { match: /\b(pharmac(?:y|ies)|drug stores?)\b/i, amenity: "pharmacy", label: "pharmacies", radius: 1200, theme: "pharmacy" },
  { match: /\b(parks?|green spaces?|playgrounds?|tree canopy|trees?\b|wetlands?)\b/i, amenity: "park", extra: ["[\"leisure\"=\"park\"]", "[\"natural\"=\"wetland\"]"], label: "parks / green space", radius: 1000, theme: "park" },
  { match: /\b(supermarkets?|grocery|groceries)\b/i, amenity: "supermarket", label: "supermarkets", radius: 1500, theme: "supermarket" },
  { match: /\b(restaurants?|cafes?|coffee)\b/i, amenity: "restaurant|cafe|fast_food", label: "food places", radius: 800, theme: "restaurant" },
  { match: /\b(banks?|atms?)\b/i, amenity: "bank|atm", label: "banks", radius: 1000, theme: "bank" },
  { match: /\b(airports?|aerodromes?)\b/i, amenity: "airport", extra: ["[\"aeroway\"=\"aerodrome\"]"], label: "airports", radius: 8000, theme: "airport" },
  { match: /\b(transit hubs?|bus stations?|train stations?|rail stations?)\b/i, amenity: "bus_station|ferry_terminal", extra: ["[\"railway\"=\"station\"]"], label: "transit hubs", radius: 2000, theme: "transit hub" },
  { match: /\b(bike[- ]?share|bicycle)\b/i, amenity: "bicycle_rental", label: "bike-share stations", radius: 800, theme: "bike share" },
  { match: /\b(volcanoes?|volcanos?)\b/i, amenity: "volcano", extra: ["[\"natural\"=\"volcano\"]"], label: "volcanoes", radius: 100000, theme: "volcano" },
  { match: /\b(emergency shelters?|shelters?)\b/i, amenity: "community_centre|shelter", label: "shelter candidates", radius: 2000, theme: "shelter" },
];

function extractPlaceHints(question: string): string[] {
  const hints: string[] = [];
  const multi = question.match(/\b(?:across|between|compare)\s+([A-Z][a-zA-Z\s,]+?)(?:\?|$)/);
  if (multi?.[1]) {
    for (const part of multi[1].split(/,| and /i)) {
      const trimmed = part.trim();
      if (trimmed.length > 2) hints.push(trimmed);
    }
  }
  const inPlace = question.match(/\bin\s+([A-Z][a-zA-Z\s-]{2,40}?)(?:\s+considering|\s+to\b|\?|$)/);
  if (inPlace?.[1]) hints.push(inPlace[1].trim());
  const forPlace = question.match(/\b(?:for|of)\s+([A-Z][a-zA-Z\s-]{2,30}?)(?:\.|\?|$)/);
  if (forPlace?.[1] && !/Earth|OpenStreetMap|OSM/i.test(forPlace[1])) hints.push(forPlace[1].trim());
  return [...new Set(hints)].slice(0, 5);
}

function extractTopN(question: string): number | undefined {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10 };
  const digit = question.match(/\b(\d+)\s+new\b/i) ?? question.match(/\bbuild\s+(\d+)\b/i);
  if (digit) return Math.min(12, Math.max(1, Number(digit[1])));
  const word = question.match(/\b(one|two|three|four|five|six|ten)\s+(?:new\s+)?(?:additional\s+)?/i);
  if (word) return words[word[1].toLowerCase()];
  return undefined;
}

function extractBudgetMillion(question: string): number | undefined {
  const match = question.match(/\$?\s*(\d+(?:\.\d+)?)\s*million/i) ?? question.match(/\$(\d+(?:\.\d+)?)[mM]\b/);
  if (!match) return undefined;
  return Number(match[1]);
}

/** Resolve skill from the raw user question only. */
export function resolveEarthIntent(question: string): EarthIntent {
  const q = question.trim();
  const lower = q.toLowerCase();
  const placeHints = extractPlaceHints(q);
  const topN = extractTopN(q);
  const budgetMillion = extractBudgetMillion(q);
  const siting = /\b(where should|where to|put another|build another|new|next|gap|underserved|locate|site|place another|maximize|optimal|best location|additional|best investment|single best)\b/i.test(lower);
  const mapping = /\b(where are|show|map|find all|list|how many|show all)\b/i.test(lower);

  // Holy-crap decision support: budget / emergency director / best investment.
  if (
    /\b(best investment|single best investment|emergency planning director|improve emergency response|response improvement|you have \$?\d|\d+\s*million\b.*\b(emergency|response|hospital|fire))/i.test(lower)
    || (/\bemergency response\b/i.test(lower) && /\b(million|budget|invest)/i.test(lower))
  ) {
    return {
      skill: "investment_decision",
      osmAmenity: "fire_station",
      osmAmenitySecondary: "hospital",
      osmExtraFilters: ["[\"healthcare\"=\"hospital\"]"],
      label: "fire stations",
      labelSecondary: "hospitals",
      serviceRadiusMeters: 3000,
      theme: "emergency investment",
      topN: 1,
      budgetMillion: budgetMillion ?? 50,
      presentation: "decision_brief",
      placeHints: placeHints.length ? placeHints : ["Calgary"],
    };
  }

  // Dual-coverage: schools far from fire stations.
  if (/\bschools?\b/i.test(lower) && /\bfire stations?\b/i.test(lower)) {
    return {
      skill: "facility_gap",
      osmAmenity: "school|university|college",
      osmAmenitySecondary: "fire_station",
      label: "schools",
      labelSecondary: "fire stations",
      serviceRadiusMeters: 2000,
      theme: "school–fire coverage",
      presentation: "gap",
      placeHints,
    };
  }

  // Hospitals unreachable if bridge collapses → bridge skill with hospital inventory secondary.
  if (/\bbridges?\b/i.test(lower) && /\bhospitals?\b/i.test(lower) && /\b(collapse|unreachable|cut off)\b/i.test(lower)) {
    return {
      skill: "bridge_siting",
      osmAmenity: "hospital",
      label: "bridges",
      labelSecondary: "hospitals",
      serviceRadiusMeters: 450,
      theme: "bridge failure",
      presentation: "decision_brief",
      placeHints,
    };
  }

  // Explicit facility / theme patterns (hospital beats incidental "crossing" in planner text).
  for (const pattern of FACILITY_PATTERNS) {
    if (pattern.match.test(q)) {
      const skill: EarthSkill = mapping && !siting
        ? "feature_map"
        : siting || /\b(underserved|accessibility|gap|coverage|benefit most|least green)\b/i.test(lower)
          ? "facility_gap"
          : mapping
            ? "feature_map"
            : "facility_gap";
      return {
        skill,
        osmAmenity: pattern.amenity,
        osmExtraFilters: pattern.extra,
        label: pattern.label,
        serviceRadiusMeters: pattern.radius,
        theme: pattern.theme,
        topN: topN ?? (skill === "facility_gap" ? 3 : undefined),
        presentation: skill === "facility_gap" ? "decision_brief" : "inventory",
        placeHints,
      };
    }
  }

  if (/\b(bridges?|river crossings?|span the river|new crossing|bridge collapses?|bridge replacement)\b/i.test(lower)) {
    return { skill: "bridge_siting", label: "bridges", serviceRadiusMeters: 450, theme: "bridge", presentation: "decision_brief", placeHints };
  }

  if (/\b(buildings?|housing|infill|develop(?:ment)?|construction|urban expansion|new construction)\b/i.test(lower)) {
    return { skill: "development_gap", label: "buildings", serviceRadiusMeters: 120, theme: "development", presentation: "gap", placeHints };
  }

  // Wow / hard questions: geocode + closest OSM layers + honest narrative.
  if (/\b(flood|sea level|wildfire|earthquake|evacuat|climate|satellite|2015|2025|forest loss|illegal mining|pipeline|solar farm|wind farm|wetland|wildlife corridor|invasive|toxic spill|pollution|air[- ]quality|zombie|meteor|isolated inhabited|next city|compare|tokyo|san francisco|istanbul|african capital)\b/i.test(lower)) {
    if (/\bflood|sea level|evacuat|wetland\b/i.test(lower)) {
      return { skill: "research_map", osmAmenity: "park", osmExtraFilters: ["[\"waterway\"~\"river|canal\"]", "[\"natural\"=\"water\"]"], label: "water & flood context", serviceRadiusMeters: 2000, theme: "flood / water", presentation: "inventory", placeHints };
    }
    if (/\bearthquake|volcano\b/i.test(lower)) {
      return { skill: "feature_map", osmAmenity: "volcano", osmExtraFilters: ["[\"natural\"=\"volcano\"]"], label: "volcanoes", serviceRadiusMeters: 100000, theme: "hazard", presentation: "inventory", placeHints };
    }
    if (/\bhospital accessibility|hospitals?\b/i.test(lower)) {
      return { skill: "facility_gap", osmAmenity: "hospital", osmExtraFilters: ["[\"healthcare\"=\"hospital\"]"], label: "hospitals", serviceRadiusMeters: 2500, theme: "hospital", presentation: "decision_brief", placeHints };
    }
    return { skill: "research_map", osmAmenity: "hospital", osmExtraFilters: ["[\"healthcare\"=\"hospital\"]"], label: "open context layers", serviceRadiusMeters: 2500, theme: "research", presentation: "inventory", placeHints };
  }

  if (/\b(where should|where to (?:put|build|place)|put another|build another|best place|optimal)\b/i.test(lower)) {
    return {
      skill: "facility_gap",
      osmAmenity: "hospital",
      osmExtraFilters: ["[\"healthcare\"=\"hospital\"]"],
      label: "facilities",
      serviceRadiusMeters: 2500,
      theme: "facility",
      presentation: "decision_brief",
      placeHints,
    };
  }

  if (mapping || /\b(show|map|where is|where are|find)\b/i.test(lower)) {
    return { skill: "feature_map", osmAmenity: "hospital", osmExtraFilters: ["[\"healthcare\"=\"hospital\"]"], label: "mapped features", serviceRadiusMeters: 1500, theme: "map", presentation: "inventory", placeHints };
  }

  return { skill: "inventory", label: "open data", serviceRadiusMeters: 1500, theme: "general", presentation: "inventory", placeHints };
}
