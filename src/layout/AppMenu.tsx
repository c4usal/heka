import { useEffect, useRef, useState } from "react";
import { Command, PanelRight, Search, Upload } from "lucide-react";
import { hekaLogo as logo } from "../assets/hekaLogo";
import { IMPORT_ACCEPT, importSpatialFile } from "../gis/importSpatialFile";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { isWebRuntime } from "../config/aiGateway";

export function AppMenu() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [menuNote, setMenuNote] = useState<string>();
  const toggleChatCollapsed = useWorkspaceStore((s) => s.toggleChatCollapsed);
  const addResolvedMapLayer = useWorkspaceStore((s) => s.addResolvedMapLayer);
  const setCameraTarget = useWorkspaceStore((s) => s.setCameraTarget);
  const showToast = useWorkspaceStore((s) => s.showToast);
  const toast = useWorkspaceStore((s) => s.toast);
  const clearToast = useWorkspaceStore((s) => s.clearToast);

  useEffect(() => {
    if (!toast && !menuNote) return;
    const timer = window.setTimeout(() => { clearToast(); setMenuNote(undefined); }, 4200);
    return () => window.clearTimeout(timer);
  }, [toast, menuNote, clearToast]);

  const comingSoon = (label: string) => {
    setMenuNote(`${label}: coming soon${isWebRuntime() ? " on web — install the desktop IDE for the full workspace." : "."}`);
  };

  const ingest = async (file: File) => {
    const result = await importSpatialFile(file);
    if (!result.ok) {
      showToast(result.comingSoon ? result.message : result.message);
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

  return <>
    <header className="menu-bar">
      <div className="app-mark" aria-label="Heka"><img src={logo} alt="Heka" /></div>
      <span className="app-name">Heka</span>
      <nav aria-label="Application menu">
        <button type="button" onClick={() => fileRef.current?.click()}>File</button>
        <button type="button" onClick={() => comingSoon("Edit")}>Edit</button>
        <button type="button" onClick={() => comingSoon("View panels")}>View</button>
        <button type="button" onClick={() => {
          document.querySelector<HTMLTextAreaElement>(".chat-composer textarea")?.focus();
          showToast("Ask Earth in the chat panel — Enter to run.");
        }}>Run</button>
      </nav>
      <button type="button" className="menu-import" onClick={() => fileRef.current?.click()} title="Import spatial data">
        <Upload size={13} /> Import
      </button>
      <label className="command-search">
        <Search size={14} />
        <input
          aria-label="Command search"
          placeholder="Search Heka commands"
          onFocus={() => comingSoon("Command palette")}
          readOnly
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
