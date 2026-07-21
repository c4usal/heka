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
struct GroqPlannerRequest { body: serde_json::Value }

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
    let key = std::env::var("HEKA_GROQ_API_KEY")
        .map_err(|_| "No secure Groq key is configured. Set HEKA_GROQ_API_KEY for the Heka desktop runtime.".to_string())?;
    let response = reqwest::Client::new()
        .post("https://api.groq.com/openai/v1/chat/completions")
        .bearer_auth(key)
        .json(&request.body)
        .timeout(std::time::Duration::from_secs(30))
        .send().await.map_err(|error| format!("Groq could not be reached: {error}"))?;
    let status = response.status();
    let payload = response.json::<serde_json::Value>().await.map_err(|error| format!("Groq returned unreadable JSON: {error}"))?;
    if !status.is_success() {
        return Err(payload.get("error").and_then(|value| value.get("message")).and_then(|value| value.as_str()).unwrap_or("Groq rejected the planner request.").to_string());
    }
    Ok(payload)
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
        .invoke_handler(tauri::generate_handler![runtime_health, request_groq_planner, execute_spatial_plan])
        .run(tauri::generate_context!())
        .expect("error while running Heka");
}
