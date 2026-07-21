use serde::{Deserialize, Serialize};
use std::{io::{BufRead, BufReader}, process::{Command, Stdio}};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeHealth { available: bool, backend: String, detail: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionRequest { data_directory: Option<String>, output_path: Option<String>, plan: serde_json::Value }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroqPlannerRequest { body: serde_json::Value, gateway_url: Option<String> }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OsmDiscoveryRequest { dataset_name: String, geographic_scope: String, #[serde(default)] kind: Option<String> }

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PlaceFocus {
    display_name: String,
    lat: f64,
    lon: f64,
    south: f64,
    north: f64,
    west: f64,
    east: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OsmDiscoveryResult {
    source_name: String,
    feature_count: usize,
    detail: String,
    geojson: String,
    output_path: String,
    place: PlaceFocus,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeocodeRequest { geographic_scope: String }

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MapLayer { id: String, name: String, kind: String, geojson: String, feature_count: i64, output_path: String }

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionResult { layer_name: String, geojson: String, output_path: String, feature_count: i64, elapsed_ms: f64, warnings: Vec<String>, #[serde(default)] map_layers: Vec<MapLayer> }

#[derive(Deserialize)]
struct WorkerEnvelope { r#type: String, payload: serde_json::Value }

fn osm_filter(name: &str, kind: Option<&str>) -> Result<&'static str, String> {
    let name = name.to_lowercase();
    let kind = kind.unwrap_or("").to_lowercase();
    // Bridges before roads so "bridge" / "crossing" never fall through to highway.
    if name.contains("bridge") || name.contains("crossing") || kind == "bridges" {
        return Ok("[\"bridge\"]");
    }
    if name.contains("building") || name.contains("footprint") || name.contains("built") {
        return Ok("[\"building\"]");
    }
    if name.contains("river") || name.contains("waterway") || name.contains("stream") || name.contains("canal") || name.contains("creek") || name.contains("coast") || kind == "waterways" {
        return Ok("[\"waterway\"~\"river|canal|stream|tidal_channel|fairway\"]");
    }
    if name.contains("water body") || name.contains("waterbody") || (name.contains("water") && name.contains("polygon")) || name.contains("lake") || name.contains("reservoir") {
        return Ok("[\"natural\"=\"water\"]");
    }
    if name.contains("road") || name.contains("street") || name.contains("highway") || name.contains("corridor") || kind == "roads" {
        // Keep arterials only — residential city-wide queries routinely time out.
        return Ok("[\"highway\"~\"motorway|trunk|primary|secondary|tertiary\"]");
    }
    if name.contains("charger") || name.contains("charging") || name.contains("ev") { return Ok("[\"amenity\"=\"charging_station\"]"); }
    if name.contains("school") || name.contains("university") || name.contains("college") { return Ok("[\"amenity\"~\"school|university|college\"]"); }
    if name.contains("hospital") || name.contains("clinic") || name.contains("medical") { return Ok("[\"amenity\"~\"hospital|clinic|doctors\"]"); }
    if name.contains("pharmacy") { return Ok("[\"amenity\"=\"pharmacy\"]"); }
    if name.contains("fire station") || name.contains("fire hall") { return Ok("[\"amenity\"=\"fire_station\"]"); }
    if name.contains("police") { return Ok("[\"amenity\"=\"police\"]"); }
    if name.contains("library") { return Ok("[\"amenity\"=\"library\"]"); }
    if name.contains("park") || name.contains("green space") { return Ok("[\"leisure\"=\"park\"]"); }
    if name.contains("restaurant") || name.contains("cafe") || name.contains("food") { return Ok("[\"amenity\"~\"restaurant|cafe|fast_food\"]"); }
    if name.contains("bank") || name.contains("atm") { return Ok("[\"amenity\"~\"bank|atm\"]"); }
    if name.contains("boundary") || name.contains("boundaries") || name.contains("district") || name.contains("neighbourhood") || name.contains("neighborhood") || name.contains("admin") || kind == "boundaries" {
        return Ok("[\"boundary\"=\"administrative\"]");
    }
    if name.contains("land use") || name.contains("landuse") || name.contains("zoning") || kind == "land_use" {
        return Ok("[\"landuse\"]");
    }
    if name.contains("facility") || name.contains("facilities") || name.contains("amenity") || kind == "facilities" {
        return Ok("[\"amenity\"]");
    }
    Err("Heka can inspect OpenStreetMap for roads, bridges, buildings, rivers/waterways, facilities, amenities, parks, administrative boundaries, and land use.".into())
}

/// Clamp huge admin Nominatim boxes to a workable window around the place center.
fn clamp_bbox(south: f64, north: f64, west: f64, east: f64, lat: f64, lon: f64) -> (f64, f64, f64, f64) {
    let max_span = 0.16; // ~18 km — any megacity stays queryable; shrink-retries handle density
    let mut s = south;
    let mut n = north;
    let mut w = west;
    let mut e = east;
    if (n - s) > max_span || (e - w) > max_span {
        let half = max_span / 2.0;
        s = lat - half;
        n = lat + half;
        w = lon - half;
        e = lon + half;
    }
    (s, n, w, e)
}

fn shrink_bbox(south: f64, north: f64, west: f64, east: f64, factor: f64) -> (f64, f64, f64, f64) {
    let lat_c = (south + north) / 2.0;
    let lon_c = (west + east) / 2.0;
    let half_lat = ((north - south) / 2.0) * factor;
    let half_lon = ((east - west) / 2.0) * factor;
    (lat_c - half_lat, lat_c + half_lat, lon_c - half_lon, lon_c + half_lon)
}

async fn overpass_query(client: &reqwest::Client, query: &str) -> Result<serde_json::Value, String> {
    let endpoints = [
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass-api.de/api/interpreter",
        "https://overpass.osm.ch/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    ];
    let mut last_error = String::from("OpenStreetMap search failed on every mirror.");
    for endpoint in endpoints {
        match client.post(endpoint)
            .header("User-Agent", "Heka/0.1 (spatial IDE; https://github.com/c4usal/heka)")
            .header("Accept", "application/json")
            .form(&[("data", query)])
            .timeout(std::time::Duration::from_secs(70))
            .send().await
        {
            Ok(response) => {
                if !response.status().is_success() {
                    last_error = format!("Overpass {} returned {}.", endpoint, response.status());
                    continue;
                }
                match response.json::<serde_json::Value>().await {
                    Ok(payload) => {
                        // Treat empty + remark as soft failure so callers can shrink bbox / retry.
                        let empty = payload.get("elements").and_then(|items| items.as_array()).map(|items| items.is_empty()).unwrap_or(true);
                        if empty {
                            if let Some(remark) = payload.get("remark").and_then(|value| value.as_str()) {
                                last_error = format!("Overpass incomplete on {endpoint}: {remark}");
                                continue;
                            }
                        }
                        return Ok(payload);
                    }
                    Err(error) => { last_error = format!("Overpass JSON error from {endpoint}: {error}"); }
                }
            }
            Err(error) => { last_error = format!("Overpass transport error from {endpoint}: {error}"); }
        }
    }
    Err(last_error)
}

fn parse_overpass_features(payload: &serde_json::Value) -> Vec<serde_json::Value> {
    payload.get("elements").and_then(|items| items.as_array()).map(|items| items.iter().filter_map(element_to_feature).collect()).unwrap_or_default()
}

async fn overpass_features(client: &reqwest::Client, query: &str) -> Result<Vec<serde_json::Value>, String> {
    let payload = overpass_query(client, query).await?;
    Ok(parse_overpass_features(&payload))
}

fn feature_family(feature: &serde_json::Value) -> &'static str {
    let tags = feature.get("properties").cloned().unwrap_or_else(|| serde_json::json!({}));
    let bridge = tags.get("bridge").and_then(|value| value.as_str()).unwrap_or("");
    let man_made = tags.get("man_made").and_then(|value| value.as_str()).unwrap_or("");
    let waterway = tags.get("waterway").and_then(|value| value.as_str()).unwrap_or("");
    let natural = tags.get("natural").and_then(|value| value.as_str()).unwrap_or("");
    let highway = tags.get("highway").and_then(|value| value.as_str()).unwrap_or("");
    if (!bridge.is_empty() && bridge != "no") || man_made == "bridge" { return "bridges"; }
    if matches!(waterway, "river" | "canal" | "stream" | "drain" | "ditch" | "tidal_channel" | "fairway")
        || matches!(natural, "water" | "bay" | "coastline")
    {
        return "waterways";
    }
    if !highway.is_empty() { return "roads"; }
    "generic"
}

fn write_geojson(name: &str, features: &[serde_json::Value]) -> Result<(String, String), String> {
    let collection = serde_json::json!({"type":"FeatureCollection","features":features});
    let safe_name: String = name.chars().map(|character| if character.is_ascii_alphanumeric() { character } else { '_' }).collect();
    let output_dir = std::env::var("USERPROFILE").map(std::path::PathBuf::from).unwrap_or_else(|_| std::env::temp_dir()).join("Documents").join("Heka").join("Dataset Resolver");
    std::fs::create_dir_all(&output_dir).map_err(|error| format!("Could not create Heka dataset directory: {error}"))?;
    let output_path = output_dir.join(format!("osm_{safe_name}.geojson"));
    let geojson = serde_json::to_string(&collection).map_err(|error| error.to_string())?;
    std::fs::write(&output_path, &geojson).map_err(|error| format!("Could not save the OpenStreetMap import: {error}"))?;
    Ok((geojson, output_path.to_string_lossy().to_string()))
}

/// Prefer a city/town hit so Lagos / London / anywhere resolve to a usable center, not a huge admin region.
async fn geocode_scope(client: &reqwest::Client, geographic_scope: &str) -> Result<(PlaceFocus, f64, f64, f64, f64), String> {
    let place = client.get("https://nominatim.openstreetmap.org/search")
        .header("User-Agent", "Heka/0.1 (https://github.com/c4usal/heka)")
        .query(&[
            ("q", geographic_scope),
            ("format", "jsonv2"),
            ("limit", "3"),
            ("addressdetails", "0"),
        ])
        .timeout(std::time::Duration::from_secs(15)).send().await.map_err(|error| format!("Location lookup failed: {error}"))?
        .json::<serde_json::Value>().await.map_err(|error| format!("Location lookup returned unreadable JSON: {error}"))?;
    let items = place.as_array().ok_or("Heka could not locate the requested geographic scope.")?;
    let item = items.iter().find(|candidate| {
        let kind = candidate.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let class = candidate.get("class").and_then(|v| v.as_str()).unwrap_or("");
        matches!(kind, "city" | "town" | "municipality" | "suburb" | "neighbourhood" | "administrative")
            || class == "place"
            || class == "boundary"
    }).or_else(|| items.first()).ok_or("Heka could not locate the requested geographic scope.")?;
    let bounding = item.get("boundingbox").and_then(|value| value.as_array()).ok_or("Heka could not locate the requested geographic scope.")?;
    let south = bounding.get(0).and_then(|v| v.as_str()).and_then(|v| v.parse::<f64>().ok()).ok_or("Invalid location bounds.")?;
    let north = bounding.get(1).and_then(|v| v.as_str()).and_then(|v| v.parse::<f64>().ok()).ok_or("Invalid location bounds.")?;
    let west = bounding.get(2).and_then(|v| v.as_str()).and_then(|v| v.parse::<f64>().ok()).ok_or("Invalid location bounds.")?;
    let east = bounding.get(3).and_then(|v| v.as_str()).and_then(|v| v.parse::<f64>().ok()).ok_or("Invalid location bounds.")?;
    let lat = item.get("lat").and_then(|v| v.as_str()).and_then(|v| v.parse::<f64>().ok()).ok_or("Invalid place latitude.")?;
    let lon = item.get("lon").and_then(|v| v.as_str()).and_then(|v| v.parse::<f64>().ok()).ok_or("Invalid place longitude.")?;
    let display_name = item.get("display_name").and_then(|v| v.as_str()).unwrap_or(geographic_scope).to_string();
    let (south, north, west, east) = clamp_bbox(south, north, west, east, lat, lon);
    Ok((PlaceFocus { display_name, lat, lon, south, north, west, east }, south, north, west, east))
}

/// Shrink bbox and retry Overpass until features appear — works for any geocoded city.
async fn overpass_with_bbox_retries(
    client: &reqwest::Client,
    mut south: f64,
    mut north: f64,
    mut west: f64,
    mut east: f64,
    build: impl Fn(f64, f64, f64, f64) -> String + Send,
) -> Vec<serde_json::Value> {
    for attempt in 0..4 {
        let query = build(south, north, west, east);
        match overpass_features(client, &query).await {
            Ok(features) if !features.is_empty() => return features,
            _ => {
                if attempt == 3 { break; }
                let shrunk = shrink_bbox(south, north, west, east, 0.65);
                south = shrunk.0;
                north = shrunk.1;
                west = shrunk.2;
                east = shrunk.3;
            }
        }
    }
    Vec::new()
}

fn element_to_feature(element: &serde_json::Value) -> Option<serde_json::Value> {
    let kind = element.get("type")?.as_str()?;
    let id = element.get("id")?.as_i64()?;
    if kind == "node" || element.get("center").is_some() {
        let (lon, lat) = if kind == "node" {
            (element.get("lon")?.as_f64()?, element.get("lat")?.as_f64()?)
        } else {
            let center = element.get("center")?;
            (center.get("lon")?.as_f64()?, center.get("lat")?.as_f64()?)
        };
        let coordinates = serde_json::json!([lon, lat]);
        let mut properties = element.get("tags").cloned().unwrap_or_else(|| serde_json::json!({}));
        if let Some(object) = properties.as_object_mut() {
            object.insert("osm_type".into(), serde_json::json!(kind));
            object.insert("osm_id".into(), serde_json::json!(id));
        }
        return Some(serde_json::json!({"type":"Feature","properties":properties,"geometry":{"type":"Point","coordinates":coordinates}}));
    }
    let points = element.get("geometry").and_then(|value| value.as_array())?;
    let coordinates: Vec<serde_json::Value> = points.iter().filter_map(|point| Some(serde_json::json!([point.get("lon")?.as_f64()?, point.get("lat")?.as_f64()?]))).collect();
    if coordinates.len() < 2 { return None; }
    let closed = coordinates.first() == coordinates.last() && coordinates.len() >= 4;
    let geometry = if closed {
        serde_json::json!({"type":"Polygon","coordinates":[coordinates]})
    } else {
        serde_json::json!({"type":"LineString","coordinates":coordinates})
    };
    let mut properties = element.get("tags").cloned().unwrap_or_else(|| serde_json::json!({}));
    if let Some(object) = properties.as_object_mut() {
        object.insert("osm_type".into(), serde_json::json!(kind));
        object.insert("osm_id".into(), serde_json::json!(id));
    }
    Some(serde_json::json!({"type":"Feature","properties":properties,"geometry":geometry}))
}

#[tauri::command]
fn runtime_health() -> RuntimeHealth {
    let launcher = qgis_launcher();
    RuntimeHealth { available: std::path::Path::new(&launcher).exists() || ogr2ogr_path().is_some(), backend: "PyQGIS / QGIS Processing".into(), detail: launcher }
}

#[tauri::command]
async fn request_groq_planner(request: GroqPlannerRequest) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let response = if let Some(gateway_url) = request.gateway_url.as_deref() {
        let base = gateway_url.trim_end_matches('/');
        if !base.starts_with("https://") || !base.ends_with(".workers.dev") {
            return Err("The configured Heka planner gateway is invalid.".to_string());
        }
        client.post(format!("{base}/v1/chat/completions"))
            .json(&request.body)
            .timeout(std::time::Duration::from_secs(60))
            .send().await.map_err(|error| format!("Heka planner gateway could not be reached: {error}"))?
    } else {
        let key = std::env::var("HEKA_GROQ_API_KEY")
            .map_err(|_| "No secure planner key is configured.".to_string())?;
        client.post("https://api.groq.com/openai/v1/chat/completions")
            .bearer_auth(key)
            .json(&request.body)
            .timeout(std::time::Duration::from_secs(30))
            .send().await.map_err(|error| format!("Groq could not be reached: {error}"))?
    };
    let status = response.status();
    let payload = response.json::<serde_json::Value>().await.map_err(|error| format!("Groq returned unreadable JSON: {error}"))?;
    if !status.is_success() {
        return Err(payload.get("error").and_then(|value| value.get("message")).and_then(|value| value.as_str()).unwrap_or("Groq rejected the planner request.").to_string());
    }
    Ok(payload)
}

#[tauri::command]
async fn geocode_place(request: GeocodeRequest) -> Result<PlaceFocus, String> {
    let client = reqwest::Client::new();
    let (place, _, _, _, _) = geocode_scope(&client, &request.geographic_scope).await?;
    Ok(place)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeSitingContext {
    place: PlaceFocus,
    roads: OsmDiscoveryResult,
    waterways: OsmDiscoveryResult,
    bridges: OsmDiscoveryResult,
    detail: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FacilityGapRequest {
    geographic_scope: String,
    #[serde(default)]
    amenity: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FacilityGapContext {
    place: PlaceFocus,
    roads: OsmDiscoveryResult,
    facilities: OsmDiscoveryResult,
    detail: String,
    amenity: String,
}

#[tauri::command]
async fn discover_osm_dataset(request: OsmDiscoveryRequest) -> Result<OsmDiscoveryResult, String> {
    let filter = osm_filter(&request.dataset_name, request.kind.as_deref())?;
    let client = reqwest::Client::new();
    let (place, south, north, west, east) = geocode_scope(&client, &request.geographic_scope).await?;
    let out = if filter.contains("building") { "out center 700;" } else { "out geom 700;" };
    let features = overpass_with_bbox_retries(&client, south, north, west, east, |s, n, w, e| {
        format!("[out:json][timeout:45];(way{filter}({s},{w},{n},{e});node{filter}({s},{w},{n},{e}););{out}")
    }).await;
    if features.is_empty() {
        return Err(format!("OpenStreetMap found no geometries for '{}' around {}.", request.dataset_name, place.display_name));
    }
    let (geojson, output_path) = write_geojson(&request.dataset_name, &features)?;
    Ok(OsmDiscoveryResult {
        source_name: "OpenStreetMap / Overpass".into(),
        feature_count: features.len(),
        detail: format!("Imported {} features from a bounded OpenStreetMap query around {}.", features.len(), place.display_name),
        geojson,
        output_path,
        place,
    })
}

/// Separate Overpass fetches for roads / water / bridges so dense cities never starve a layer.
#[tauri::command]
async fn discover_bridge_siting_context(request: GeocodeRequest) -> Result<BridgeSitingContext, String> {
    let client = reqwest::Client::new();
    let (place, south, north, west, east) = geocode_scope(&client, &request.geographic_scope).await?;

    let roads = overpass_with_bbox_retries(&client, south, north, west, east, |s, n, w, e| {
        format!(
            "[out:json][timeout:45];\
             way[\"highway\"~\"motorway|trunk|primary|secondary|tertiary\"]({s},{w},{n},{e});\
             out geom 700;"
        )
    }).await;

    let mut waterways = overpass_with_bbox_retries(&client, south, north, west, east, |s, n, w, e| {
        format!(
            "[out:json][timeout:45];(\
               way[\"waterway\"~\"river|canal|stream|tidal_channel|fairway\"]({s},{w},{n},{e});\
               way[\"natural\"=\"water\"]({s},{w},{n},{e});\
             );out geom 500;"
        )
    }).await;

    // Coastline fallback for lagoon / harbour cities (Lagos, coastal megacities).
    if waterways.is_empty() {
        waterways = overpass_with_bbox_retries(&client, south, north, west, east, |s, n, w, e| {
            format!(
                "[out:json][timeout:45];(\
                   way[\"natural\"=\"coastline\"]({s},{w},{n},{e});\
                   way[\"waterway\"]({s},{w},{n},{e});\
                 );out geom 400;"
            )
        }).await;
    }

    let bridges = overpass_with_bbox_retries(&client, south, north, west, east, |s, n, w, e| {
        format!(
            "[out:json][timeout:45];(\
               way[\"bridge\"]({s},{w},{n},{e});\
               way[\"man_made\"=\"bridge\"]({s},{w},{n},{e});\
               node[\"man_made\"=\"bridge\"]({s},{w},{n},{e});\
               way[\"highway\"][\"bridge\"~\"yes|movable|cantilever|aqueduct\"]({s},{w},{n},{e});\
             );out geom 500;"
        )
    }).await;

    if roads.is_empty() {
        return Err(format!("OpenStreetMap returned no arterial roads around {}.", place.display_name));
    }
    if waterways.is_empty() {
        return Err(format!("OpenStreetMap returned no waterways/coastline around {} — cannot site a bridge without a water corridor.", place.display_name));
    }

    let (roads_geojson, roads_path) = write_geojson("bridge_context_roads", &roads)?;
    let (water_geojson, water_path) = write_geojson("bridge_context_waterways", &waterways)?;
    let (bridge_geojson, bridge_path) = write_geojson("bridge_context_bridges", &bridges)?;
    let detail = format!(
        "Bridge context around {}: {} arterial roads, {} water segments, {} existing bridges (layers fetched separately).",
        place.display_name, roads.len(), waterways.len(), bridges.len()
    );
    Ok(BridgeSitingContext {
        place: place.clone(),
        roads: OsmDiscoveryResult { source_name: "OpenStreetMap / Overpass".into(), feature_count: roads.len(), detail: detail.clone(), geojson: roads_geojson, output_path: roads_path, place: place.clone() },
        waterways: OsmDiscoveryResult { source_name: "OpenStreetMap / Overpass".into(), feature_count: waterways.len(), detail: detail.clone(), geojson: water_geojson, output_path: water_path, place: place.clone() },
        bridges: OsmDiscoveryResult { source_name: "OpenStreetMap / Overpass".into(), feature_count: bridges.len(), detail: detail.clone(), geojson: bridge_geojson, output_path: bridge_path, place },
        detail,
    })
}

fn facility_query_parts(amenity: &str, south: f64, north: f64, west: f64, east: f64) -> String {
    let mut parts: Vec<String> = Vec::new();
    if amenity == "park" {
        parts.push(format!("node[\"leisure\"=\"park\"]({south},{west},{north},{east})"));
        parts.push(format!("way[\"leisure\"=\"park\"]({south},{west},{north},{east})"));
        parts.push(format!("node[\"leisure\"=\"playground\"]({south},{west},{north},{east})"));
        parts.push(format!("way[\"natural\"=\"wetland\"]({south},{west},{north},{east})"));
    } else if amenity == "volcano" {
        parts.push(format!("node[\"natural\"=\"volcano\"]({south},{west},{north},{east})"));
        parts.push(format!("way[\"natural\"=\"volcano\"]({south},{west},{north},{east})"));
    } else if amenity == "airport" {
        parts.push(format!("node[\"aeroway\"=\"aerodrome\"]({south},{west},{north},{east})"));
        parts.push(format!("way[\"aeroway\"=\"aerodrome\"]({south},{west},{north},{east})"));
        parts.push(format!("node[\"amenity\"=\"airport\"]({south},{west},{north},{east})"));
    } else if amenity.contains('|') {
        parts.push(format!("node[\"amenity\"~\"{amenity}\"]({south},{west},{north},{east})"));
        parts.push(format!("way[\"amenity\"~\"{amenity}\"]({south},{west},{north},{east})"));
        if amenity.contains("bus_station") || amenity.contains("ferry_terminal") {
            parts.push(format!("node[\"railway\"=\"station\"]({south},{west},{north},{east})"));
            parts.push(format!("way[\"railway\"=\"station\"]({south},{west},{north},{east})"));
        }
    } else {
        parts.push(format!("node[\"amenity\"=\"{amenity}\"]({south},{west},{north},{east})"));
        parts.push(format!("way[\"amenity\"=\"{amenity}\"]({south},{west},{north},{east})"));
        if amenity == "hospital" {
            parts.push(format!("node[\"healthcare\"=\"hospital\"]({south},{west},{north},{east})"));
            parts.push(format!("way[\"healthcare\"=\"hospital\"]({south},{west},{north},{east})"));
        }
        if amenity == "charging_station" {
            parts.push(format!("node[\"charging_station\"=\"yes\"]({south},{west},{north},{east})"));
        }
    }
    parts.join(";")
}

/// Separate road + facility fetches so any city can return both layers.
#[tauri::command]
async fn discover_facility_gap_context(request: FacilityGapRequest) -> Result<FacilityGapContext, String> {
    let amenity = request.amenity.unwrap_or_else(|| "hospital".into());
    let client = reqwest::Client::new();
    let (place, south, north, west, east) = geocode_scope(&client, &request.geographic_scope).await?;

    let roads = overpass_with_bbox_retries(&client, south, north, west, east, |s, n, w, e| {
        format!(
            "[out:json][timeout:45];\
             way[\"highway\"~\"motorway|trunk|primary|secondary|tertiary\"]({s},{w},{n},{e});\
             out geom 700;"
        )
    }).await;

    let facilities = overpass_with_bbox_retries(&client, south, north, west, east, |s, n, w, e| {
        let union = facility_query_parts(&amenity, s, n, w, e);
        format!("[out:json][timeout:45];({union};);out center;")
    }).await;

    if roads.is_empty() {
        return Err(format!("OpenStreetMap returned no arterial roads around {}.", place.display_name));
    }
    if facilities.is_empty() {
        return Err(format!("OpenStreetMap returned no '{amenity}' features around {}.", place.display_name));
    }

    let (roads_geojson, roads_path) = write_geojson("facility_context_roads", &roads)?;
    let (facilities_geojson, facilities_path) = write_geojson("facility_context_facilities", &facilities)?;
    let detail = format!(
        "Facility context around {}: {} road features, {} {} features (layers fetched separately).",
        place.display_name, roads.len(), facilities.len(), amenity
    );
    Ok(FacilityGapContext {
        place: place.clone(),
        roads: OsmDiscoveryResult { source_name: "OpenStreetMap / Overpass".into(), feature_count: roads.len(), detail: detail.clone(), geojson: roads_geojson, output_path: roads_path, place: place.clone() },
        facilities: OsmDiscoveryResult { source_name: "OpenStreetMap / Overpass".into(), feature_count: facilities.len(), detail: detail.clone(), geojson: facilities_geojson, output_path: facilities_path, place },
        detail,
        amenity,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConvertSpatialRequest {
    file_name: String,
    bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConvertSpatialResult {
    name: String,
    geojson: String,
    feature_count: usize,
    format: String,
}

fn qgis_launcher() -> String {
    std::env::var("HEKA_QGIS_PYTHON").unwrap_or_else(|_| r"C:\OSGeo4W\bin\python-qgis-ltr.bat".to_string())
}

fn ogr2ogr_path() -> Option<std::path::PathBuf> {
    let candidates = [
        std::path::PathBuf::from(r"C:\OSGeo4W\bin\ogr2ogr.exe"),
        std::path::PathBuf::from(r"C:\Program Files\QGIS 3.40.5\bin\ogr2ogr.exe"),
        std::path::PathBuf::from(r"C:\Program Files\QGIS 3.34.13\bin\ogr2ogr.exe"),
    ];
    candidates.into_iter().find(|path| path.exists())
}

#[tauri::command]
async fn convert_spatial_to_geojson(request: ConvertSpatialRequest) -> Result<ConvertSpatialResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let lower = request.file_name.to_lowercase();
        let format = if lower.ends_with(".gpkg") || lower.ends_with(".geopackage") {
            "GeoPackage"
        } else if lower.ends_with(".zip") || lower.ends_with(".shp") {
            "Shapefile"
        } else {
            "Spatial"
        };
        let launcher = qgis_launcher();
        let ogr = ogr2ogr_path();
        if !std::path::Path::new(&launcher).exists() && ogr.is_none() {
            return Err("QGIS LTR / OSGeo4W was not found. Install QGIS or set HEKA_QGIS_PYTHON to convert Shapefile and GeoPackage.".into());
        }

        let temp_root = std::env::temp_dir().join(format!("heka-import-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp_root);
        std::fs::create_dir_all(&temp_root).map_err(|error| format!("Could not create temp import folder: {error}"))?;
        let input_path = temp_root.join(&request.file_name);
        std::fs::write(&input_path, &request.bytes).map_err(|error| format!("Could not stage import file: {error}"))?;
        let output_path = temp_root.join("converted.geojson");

        let status = if let Some(ogr_bin) = ogr {
            Command::new(ogr_bin)
                .args([
                    "-f", "GeoJSON",
                    "-t_srs", "EPSG:4326",
                    "-lco", "RFC7946=YES",
                    &output_path.to_string_lossy(),
                    &input_path.to_string_lossy(),
                ])
                .status()
                .map_err(|error| format!("ogr2ogr failed to start: {error}"))?
        } else {
            let py = format!(
                "from osgeo import ogr, osr\nimport sys\nin_path=r'''{}'''\nout_path=r'''{}'''\nsrc=ogr.Open(in_path)\nif src is None:\n    raise SystemExit('Could not open input dataset')\ndriver=ogr.GetDriverByName('GeoJSON')\nif driver is None:\n    raise SystemExit('GeoJSON driver missing')\nif driver.CreateDataSource(out_path) is None:\n    pass\nosr.DontUseExceptions()\nfrom osgeo import gdal\ngdal.VectorTranslate(out_path, in_path, format='GeoJSON', dstSRS='EPSG:4326', layerCreationOptions=['RFC7946=YES'])\n",
                input_path.to_string_lossy().replace('\\', "\\\\"),
                output_path.to_string_lossy().replace('\\', "\\\\"),
            );
            let script_path = temp_root.join("convert.py");
            std::fs::write(&script_path, py).map_err(|error| error.to_string())?;
            Command::new("cmd")
                .args(["/C", launcher.as_str(), &script_path.to_string_lossy()])
                .status()
                .map_err(|error| format!("QGIS Python convert failed to start: {error}"))?
        };

        if !status.success() {
            let _ = std::fs::remove_dir_all(&temp_root);
            return Err(format!("Could not convert {} with GDAL/QGIS (exit {}).", request.file_name, status.code().unwrap_or(-1)));
        }
        let geojson = std::fs::read_to_string(&output_path).map_err(|error| format!("Converted GeoJSON missing: {error}"))?;
        let feature_count = geojson.matches("\"type\": \"Feature\"").count()
            .max(geojson.matches("\"type\":\"Feature\"").count());
        let name = request.file_name.rsplit(['/', '\\']).next().unwrap_or(&request.file_name)
            .rsplit_once('.').map(|(stem, _)| stem.replace(['_', '-'], " "))
            .unwrap_or_else(|| request.file_name.clone());
        let _ = std::fs::remove_dir_all(&temp_root);
        Ok(ConvertSpatialResult { name, geojson, feature_count, format: format.into() })
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn execute_spatial_plan(app: AppHandle, request: ExecutionRequest) -> Result<ExecutionResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let development_script = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../worker/heka_worker.py");
        let script = if development_script.exists() {
            development_script
        } else {
            let resources = app.path().resource_dir().map_err(|error| error.to_string())?;
            [resources.join("worker/heka_worker.py"), resources.join("_up_/worker/heka_worker.py")]
                .into_iter()
                .find(|candidate| candidate.exists())
                .ok_or("The bundled PyQGIS worker could not be found.")?
        };
        let launcher = qgis_launcher();
        if !std::path::Path::new(&launcher).exists() { return Err("QGIS LTR was not found. Install QGIS through OSGeo4W or set HEKA_QGIS_PYTHON to python-qgis-ltr.bat.".into()); }
        let input = serde_json::json!({ "action": "execute-plan", "plan": request.plan, "dataDirectory": request.data_directory, "outputPath": request.output_path }).to_string();
        let script_path = script.to_string_lossy().to_string();
        let mut child = Command::new("cmd").args(["/C", launcher.as_str(), script_path.as_str()]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|error| format!("Could not start the PyQGIS worker: {error}"))?;
        use std::io::Write;
        child.stdin.as_mut().ok_or("PyQGIS worker stdin was unavailable")?.write_all(format!("{input}\n").as_bytes()).map_err(|error| error.to_string())?;
        let stdout = child.stdout.take().ok_or("PyQGIS worker stdout was unavailable")?;
        for line in BufReader::new(stdout).lines() {
            let line = line.map_err(|error| error.to_string())?;
            let event: WorkerEnvelope = serde_json::from_str(&line).map_err(|_| format!("PyQGIS worker returned malformed output: {line}"))?;
            match event.r#type.as_str() {
                "progress" => { app.emit("heka://execution-progress", event.payload).map_err(|error| error.to_string())?; }
                "result" => return serde_json::from_value(event.payload).map_err(|error| format!("Invalid PyQGIS result: {error}")),
                "error" => return Err(event.payload.get("message").and_then(|value| value.as_str()).unwrap_or("PyQGIS execution failed.").to_string()),
                _ => {}
            }
        }
        let stderr = child.stderr.take().map(|stream| BufReader::new(stream).lines().filter_map(Result::ok).collect::<Vec<_>>().join("\n")).unwrap_or_default();
        Err(if stderr.is_empty() { "PyQGIS worker ended without a result.".into() } else { stderr })
    }).await.map_err(|error| error.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![runtime_health, request_groq_planner, geocode_place, discover_osm_dataset, discover_bridge_siting_context, discover_facility_gap_context, convert_spatial_to_geojson, execute_spatial_plan])
        .run(tauri::generate_context!())
        .expect("error while running Heka");
}
