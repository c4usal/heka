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
struct OsmDiscoveryRequest { dataset_name: String, geographic_scope: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OsmDiscoveryResult { source_name: String, feature_count: usize, detail: String, geojson: String, output_path: String }

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MapLayer { id: String, name: String, kind: String, geojson: String, feature_count: i64, output_path: String }

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionResult { layer_name: String, geojson: String, output_path: String, feature_count: i64, elapsed_ms: f64, warnings: Vec<String>, #[serde(default)] map_layers: Vec<MapLayer> }

#[derive(Deserialize)]
struct WorkerEnvelope { r#type: String, payload: serde_json::Value }

#[tauri::command]
fn runtime_health() -> RuntimeHealth {
    // The worker process is intentionally owned by the desktop shell. The UI talks to it
    // through typed commands/events rather than spawning GIS processes directly.
    let launcher = std::env::var("HEKA_QGIS_PYTHON").unwrap_or_else(|_| r"C:\OSGeo4W\bin\python-qgis-ltr.bat".to_string());
    RuntimeHealth { available: std::path::Path::new(&launcher).exists(), backend: "PyQGIS / QGIS Processing".into(), detail: launcher }
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
            .timeout(std::time::Duration::from_secs(30))
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
async fn discover_osm_dataset(request: OsmDiscoveryRequest) -> Result<OsmDiscoveryResult, String> {
    let name = request.dataset_name.to_lowercase();
    let filter = if name.contains("road") || name.contains("street") { "[\"highway\"]" }
        else if name.contains("charger") || name.contains("charging") { "[\"amenity\"=\"charging_station\"]" }
        else if name.contains("school") { "[\"amenity\"=\"school\"]" }
        else if name.contains("hospital") { "[\"amenity\"=\"hospital\"]" }
        else if name.contains("fire station") { "[\"amenity\"=\"fire_station\"]" }
        else if name.contains("park") { "[\"leisure\"=\"park\"]" }
        else { return Err("Heka can currently inspect OpenStreetMap sources for roads, chargers, schools, hospitals, fire stations, and parks.".into()); };
    let client = reqwest::Client::new();
    let place = client.get("https://nominatim.openstreetmap.org/search")
        .header("User-Agent", "Heka Dataset Resolver/0.1 (https://github.com/c4usal/heka)")
        .query(&[("q", request.geographic_scope.as_str()), ("format", "jsonv2"), ("limit", "1")])
        .timeout(std::time::Duration::from_secs(15)).send().await.map_err(|error| format!("Location lookup failed: {error}"))?
        .json::<serde_json::Value>().await.map_err(|error| format!("Location lookup returned unreadable JSON: {error}"))?;
    let bounding = place.as_array().and_then(|items| items.first()).and_then(|item| item.get("boundingbox")).and_then(|value| value.as_array()).ok_or("Heka could not locate the requested geographic scope.")?;
    let south = bounding.get(0).and_then(|v| v.as_str()).ok_or("Invalid location bounds.")?;
    let north = bounding.get(1).and_then(|v| v.as_str()).ok_or("Invalid location bounds.")?;
    let west = bounding.get(2).and_then(|v| v.as_str()).ok_or("Invalid location bounds.")?;
    let east = bounding.get(3).and_then(|v| v.as_str()).ok_or("Invalid location bounds.")?;
    let query = format!("[out:json][timeout:25];nwr{filter}({south},{west},{north},{east});out geom 1000;");
    let payload = client.post("https://overpass-api.de/api/interpreter")
        .header("User-Agent", "Heka Dataset Resolver/0.1 (https://github.com/c4usal/heka)")
        .form(&[("data", query)]).timeout(std::time::Duration::from_secs(35)).send().await.map_err(|error| format!("OpenStreetMap search failed: {error}"))?
        .json::<serde_json::Value>().await.map_err(|error| format!("OpenStreetMap returned unreadable JSON: {error}"))?;
    let elements = payload.get("elements").and_then(|items| items.as_array()).ok_or("OpenStreetMap did not return a feature collection.")?;
    let features = elements.iter().filter_map(|element| {
        let kind = element.get("type")?.as_str()?;
        let id = element.get("id")?.as_i64()?;
        let coordinates = if kind == "node" {
            serde_json::json!([element.get("lon")?.as_f64()?, element.get("lat")?.as_f64()?])
        } else if let Some(points) = element.get("geometry").and_then(|value| value.as_array()) {
            let coordinates: Vec<serde_json::Value> = points.iter().filter_map(|point| Some(serde_json::json!([point.get("lon")?.as_f64()?, point.get("lat")?.as_f64()?]))).collect();
            if coordinates.len() < 2 { return None; }
            serde_json::json!(coordinates)
        } else { return None; };
        let geometry = if kind == "node" { serde_json::json!({"type":"Point","coordinates":coordinates}) } else { serde_json::json!({"type":"LineString","coordinates":coordinates}) };
        let mut properties = element.get("tags").cloned().unwrap_or_else(|| serde_json::json!({}));
        if let Some(object) = properties.as_object_mut() { object.insert("osm_type".into(), serde_json::json!(kind)); object.insert("osm_id".into(), serde_json::json!(id)); }
        Some(serde_json::json!({"type":"Feature","properties":properties,"geometry":geometry}))
    }).collect::<Vec<_>>();
    if features.is_empty() { return Err("OpenStreetMap found no supported geometries for this search.".into()); }
    let collection = serde_json::json!({"type":"FeatureCollection","features":features});
    let safe_name: String = request.dataset_name.chars().map(|character| if character.is_ascii_alphanumeric() { character } else { '_' }).collect();
    let output_dir = std::env::var("USERPROFILE").map(std::path::PathBuf::from).unwrap_or_else(|_| std::env::temp_dir()).join("Documents").join("Heka").join("Dataset Resolver");
    std::fs::create_dir_all(&output_dir).map_err(|error| format!("Could not create Heka dataset directory: {error}"))?;
    let output_path = output_dir.join(format!("osm_{safe_name}.geojson"));
    let geojson = serde_json::to_string(&collection).map_err(|error| error.to_string())?;
    std::fs::write(&output_path, &geojson).map_err(|error| format!("Could not save the OpenStreetMap import: {error}"))?;
    Ok(OsmDiscoveryResult { source_name: "OpenStreetMap / Overpass".into(), feature_count: features.len(), detail: "Imported from a bounded 1,000-feature OpenStreetMap query. Verify completeness and licensing before operational use.".into(), geojson, output_path: output_path.to_string_lossy().to_string() })
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
        let launcher = std::env::var("HEKA_QGIS_PYTHON").unwrap_or_else(|_| r"C:\OSGeo4W\bin\python-qgis-ltr.bat".to_string());
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
        .invoke_handler(tauri::generate_handler![runtime_health, request_groq_planner, discover_osm_dataset, execute_spatial_plan])
        .run(tauri::generate_context!())
        .expect("error while running Heka");
}
