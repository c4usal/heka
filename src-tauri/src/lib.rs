use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeHealth { available: bool, backend: String, detail: String }

#[tauri::command]
fn runtime_health() -> RuntimeHealth {
    // The worker process is intentionally owned by the desktop shell. The UI talks to it
    // through typed commands/events rather than spawning GIS processes directly.
    RuntimeHealth { available: false, backend: "PyQGIS".into(), detail: "Worker bootstrap pending configuration".into() }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![runtime_health])
        .run(tauri::generate_context!())
        .expect("error while running Heka");
}
