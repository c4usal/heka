import { Group, Panel, Separator } from "react-resizable-panels";
import { FilePlus2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { hekaLogo as logo } from "../assets/hekaLogo";
import { IMPORT_ACCEPT, importSpatialFile } from "../gis/importSpatialFile";
import { GlobePanel } from "../panels/globe/GlobePanel";
import { PlannerComposer } from "../panels/planner/PlannerComposer";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { isWebRuntime } from "../config/aiGateway";

export function WorkspaceLayout() {
  const chatCollapsed = useWorkspaceStore((state) => state.chatCollapsed);
  const setHorizontalLayout = useWorkspaceStore((state) => state.setHorizontalLayout);
  const addResolvedMapLayer = useWorkspaceStore((state) => state.addResolvedMapLayer);
  const setCameraTarget = useWorkspaceStore((state) => state.setCameraTarget);
  const showToast = useWorkspaceStore((state) => state.showToast);
  const [dragging, setDragging] = useState(false);

  // Freeze default layout once — writing layout back into defaultLayout caused React #185
  // (onLayoutChanged → setState → new defaultLayout → onLayoutChanged…).
  const initialLayout = useRef({ canvas: 72, chat: 28 });

  const onLayoutChanged = useCallback((sizes: Record<string, number>) => {
    const center = Math.round(sizes.canvas ?? 72);
    const right = Math.round(sizes.chat ?? 28);
    const current = useWorkspaceStore.getState().workspace.layout;
    if (Math.abs(current.center - center) < 1 && Math.abs(current.right - right) < 1) return;
    setHorizontalLayout({ left: 0, center, right });
  }, [setHorizontalLayout]);

  const ingestFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    for (const file of list) {
      const result = await importSpatialFile(file);
      if (!result.ok) {
        showToast(result.message);
        continue;
      }
      addResolvedMapLayer({
        id: `import-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
      showToast(`Imported ${result.featureCount} features · ${result.format}`);
    }
  };

  const mapPane = (
    <section
      className={`tab-workspace ${dragging ? "drop-active" : ""}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (event.dataTransfer.files?.length) void ingestFiles(event.dataTransfer.files);
      }}
    >
      <header className="tab-strip" aria-label="Workspace tabs">
        <button className="workspace-tab active" type="button">
          <img src={logo} alt="" /><span>Earth map</span>
        </button>
          <button
            className="new-tab"
            type="button"
            title="Multi-document tabs are in the full Windows IDE"
            onClick={() => showToast(isWebRuntime()
              ? "Multi-document tabs ship in the full Windows IDE — download from the banner."
              : "Open another analysis tab from File or keep working on this map.")}
          >
            <FilePlus2 size={16} />
          </button>
      </header>
      <div className="tab-content">
        <GlobePanel />
        {dragging && (
          <div className="drop-overlay">
            <strong>Drop spatial files</strong>
            <span>GeoJSON · KML · CSV · (Shapefile / GeoPackage / GeoTIFF — convert for web)</span>
            <input type="file" accept={IMPORT_ACCEPT} multiple hidden />
          </div>
        )}
      </div>
    </section>
  );

  if (chatCollapsed) {
    return <div className="cursor-workspace">{mapPane}</div>;
  }

  return (
    <Group
      className="cursor-workspace"
      orientation="horizontal"
      defaultLayout={initialLayout.current}
      onLayoutChanged={onLayoutChanged}
    >
      <Panel id="canvas" minSize="42%" defaultSize={initialLayout.current.canvas}>
        {mapPane}
      </Panel>
      <Separator className="chat-resize-handle" />
      <Panel id="chat" minSize="22%" maxSize="48%" defaultSize={initialLayout.current.chat}>
        <PlannerComposer />
      </Panel>
    </Group>
  );
}
