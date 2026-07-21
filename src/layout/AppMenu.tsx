import { useEffect, useRef, useState } from "react";
import { Command, PanelRight, Search, Upload } from "lucide-react";
import { hekaLogo as logo } from "../assets/hekaLogo";
import { checkPyQgisRuntime } from "../execution/pyqgisExecution";
import { IMPORT_ACCEPT, importSpatialFile } from "../gis/importSpatialFile";
import { isTauriRuntime } from "../config/aiGateway";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";

export function AppMenu() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [menuNote, setMenuNote] = useState<string>();
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const toggleChatCollapsed = useWorkspaceStore((s) => s.toggleChatCollapsed);
  const toggleInspector = useWorkspaceStore((s) => s.toggleInspector);
  const inspectorOpen = useWorkspaceStore((s) => s.inspectorOpen);
  const chatCollapsed = useWorkspaceStore((s) => s.chatCollapsed);
  const addDocument = useWorkspaceStore((s) => s.addDocument);
  const addResolvedMapLayer = useWorkspaceStore((s) => s.addResolvedMapLayer);
  const setCameraTarget = useWorkspaceStore((s) => s.setCameraTarget);
  const showToast = useWorkspaceStore((s) => s.showToast);
  const setQgisHealth = useWorkspaceStore((s) => s.setQgisHealth);
  const qgisHealth = useWorkspaceStore((s) => s.qgisHealth);
  const toast = useWorkspaceStore((s) => s.toast);
  const clearToast = useWorkspaceStore((s) => s.clearToast);

  useEffect(() => {
    if (!toast && !menuNote) return;
    const timer = window.setTimeout(() => { clearToast(); setMenuNote(undefined); }, 4200);
    return () => window.clearTimeout(timer);
  }, [toast, menuNote, clearToast]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void checkPyQgisRuntime().then((health) => {
      setQgisHealth(health);
      if (!health.available) {
        showToast("QGIS LTR not detected — open-data tools still work. Install QGIS for Processing / Shapefile import.");
      }
    }).catch(() => {
      setQgisHealth({ available: false, backend: "PyQGIS / QGIS Processing", detail: "unavailable" });
    });
  }, [setQgisHealth, showToast]);

  const ingest = async (file: File) => {
    const result = await importSpatialFile(file);
    if (!result.ok) {
      showToast(result.message);
      return;
    }
    const id = `import-${Date.now()}`;
    addResolvedMapLayer({
      id,
      name: result.name,
      kind: "generic",
      geojson: result.geojson,
      featureCount: result.featureCount,
      outputPath: `import://${file.name}`,
      source: "import",
    });
    try {
      const fc = JSON.parse(result.geojson) as { features?: Array<{ geometry?: { type?: string; coordinates?: unknown } }> };
      const first = fc.features?.[0]?.geometry;
      if (first?.type === "Point" && Array.isArray(first.coordinates)) {
        const [lon, lat] = first.coordinates as number[];
        setCameraTarget({ lon, lat, height: 80_000, label: result.name });
      }
    } catch { /* ignore */ }
    showToast(`Imported ${result.featureCount} features from ${result.format}.`);
  };

  const closeMenus = () => {
    setFileMenuOpen(false);
    setViewMenuOpen(false);
  };

  return <>
    <header className="menu-bar">
      <div className="app-mark" aria-label="Heka"><img src={logo} alt="Heka" /></div>
      <span className="app-name">Heka</span>
      <nav aria-label="Application menu">
        <div className="menu-item">
          <button type="button" onClick={() => { setFileMenuOpen((v) => !v); setViewMenuOpen(false); }}>File</button>
          {fileMenuOpen && (
            <div className="menu-dropdown" role="menu">
              <button type="button" role="menuitem" onClick={() => { closeMenus(); fileRef.current?.click(); }}>Import…</button>
              <button type="button" role="menuitem" onClick={() => { closeMenus(); addDocument(); showToast("Opened a new map document."); }}>New tab</button>
            </div>
          )}
        </div>
        <div className="menu-item">
          <button type="button" onClick={() => { setViewMenuOpen((v) => !v); setFileMenuOpen(false); }}>View</button>
          {viewMenuOpen && (
            <div className="menu-dropdown" role="menu">
              <button type="button" role="menuitem" onClick={() => { closeMenus(); toggleChatCollapsed(); }}>
                {chatCollapsed ? "Show chat panel" : "Hide chat panel"}
              </button>
              <button type="button" role="menuitem" onClick={() => { closeMenus(); toggleInspector(); }}>
                {inspectorOpen ? "Hide Reasoning Inspector" : "Show Reasoning Inspector"}
              </button>
            </div>
          )}
        </div>
        <button type="button" onClick={() => {
          closeMenus();
          document.querySelector<HTMLTextAreaElement>(".chat-composer textarea")?.focus();
          showToast("Ask Earth in the chat panel — Enter to run.");
        }}>Run</button>
      </nav>
      <button type="button" className="menu-import" onClick={() => fileRef.current?.click()} title="Import spatial data">
        <Upload size={13} /> Import
      </button>
      {qgisHealth && (
        <span className={`runtime-pill ${qgisHealth.available ? "ok" : "warn"}`} title={qgisHealth.detail}>
          {qgisHealth.available ? "QGIS ready" : "QGIS offline"}
        </span>
      )}
      <label className="command-search">
        <Search size={14} />
        <input
          aria-label="Command search"
          placeholder="Search layers & commands (coming soon)"
          readOnly
          onFocus={() => setMenuNote("Command palette is next — use File / Import and Ask Earth for now.")}
        />
        <kbd><Command size={10} /> P</kbd>
      </label>
      <button className="chrome-icon" type="button" title="Toggle chat panel" onClick={() => toggleChatCollapsed()}>
        <PanelRight size={16} />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept={IMPORT_ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void ingest(file);
        }}
      />
    </header>
    {(toast || menuNote) && <div className="app-toast" role="status">{toast ?? menuNote}</div>}
  </>;
}
