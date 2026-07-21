import { Group, Panel, Separator } from "react-resizable-panels";
import { FilePlus2, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { hekaLogo as logo } from "../assets/hekaLogo";
import { isTauriRuntime, isWebRuntime } from "../config/aiGateway";
import { importSpatialFile } from "../gis/importSpatialFile";
import { GlobePanel } from "../panels/globe/GlobePanel";
import { ReasoningInspectorPanel } from "../panels/inspector/ReasoningInspectorPanel";
import { PlannerComposer } from "../panels/planner/PlannerComposer";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";

export function WorkspaceLayout() {
  const chatCollapsed = useWorkspaceStore((state) => state.chatCollapsed);
  const inspectorOpen = useWorkspaceStore((state) => state.inspectorOpen);
  const documents = useWorkspaceStore((state) => state.documents);
  const activeDocumentId = useWorkspaceStore((state) => state.activeDocumentId);
  const addDocument = useWorkspaceStore((state) => state.addDocument);
  const closeDocument = useWorkspaceStore((state) => state.closeDocument);
  const setActiveDocument = useWorkspaceStore((state) => state.setActiveDocument);
  const setHorizontalLayout = useWorkspaceStore((state) => state.setHorizontalLayout);
  const addResolvedMapLayer = useWorkspaceStore((state) => state.addResolvedMapLayer);
  const setCameraTarget = useWorkspaceStore((state) => state.setCameraTarget);
  const showToast = useWorkspaceStore((state) => state.showToast);
  const [dragging, setDragging] = useState(false);
  const desktop = isTauriRuntime();
  const web = isWebRuntime();

  const initialLayout = useRef({ canvas: 58, chat: 27, inspector: 15 });

  const onLayoutChanged = useCallback((sizes: Record<string, number>) => {
    const center = Math.round(sizes.canvas ?? 58);
    const right = Math.round((sizes.chat ?? 27) + (sizes.inspector ?? 0));
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

  const onNewTab = () => {
    if (web) {
      showToast("Multi-document tabs ship in the full Windows IDE — download from the banner.");
      return;
    }
    addDocument();
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
        {documents.map((doc) => (
          <button
            key={doc.id}
            className={`workspace-tab ${doc.id === activeDocumentId ? "active" : ""}`}
            type="button"
            onClick={() => setActiveDocument(doc.id)}
            onAuxClick={(event) => {
              if (event.button === 1 && desktop) {
                event.preventDefault();
                closeDocument(doc.id);
              }
            }}
          >
            <img src={logo} alt="" />
            <span>{doc.title}</span>
            {desktop && documents.length > 1 && (
              <span
                className="tab-close"
                role="button"
                tabIndex={0}
                title="Close tab"
                onClick={(event) => {
                  event.stopPropagation();
                  closeDocument(doc.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.stopPropagation();
                    closeDocument(doc.id);
                  }
                }}
              >
                <X size={12} />
              </span>
            )}
          </button>
        ))}
        <button
          className="new-tab"
          type="button"
          title={web ? "Multi-document tabs are in the full Windows IDE" : "New map document"}
          onClick={onNewTab}
        >
          <FilePlus2 size={16} />
        </button>
      </header>
      <div className="tab-content">
        <GlobePanel />
        {dragging && (
          <div className="drop-overlay">
            <strong>Drop spatial files</strong>
            <span>
              {desktop
                ? "GeoJSON · KML · CSV · Shapefile (.zip) · GeoPackage"
                : "GeoJSON · KML · CSV · (Shapefile / GeoPackage — convert for web)"}
            </span>
          </div>
        )}
      </div>
    </section>
  );

  if (chatCollapsed) {
    return <div className="cursor-workspace">{mapPane}</div>;
  }

  const showInspector = desktop && inspectorOpen;

  return (
    <Group
      className="cursor-workspace"
      orientation="horizontal"
      defaultLayout={showInspector ? initialLayout.current : { canvas: 72, chat: 28 }}
      onLayoutChanged={onLayoutChanged}
    >
      <Panel id="canvas" minSize="36%" defaultSize={showInspector ? initialLayout.current.canvas : 72}>
        {mapPane}
      </Panel>
      <Separator className="chat-resize-handle" />
      <Panel id="chat" minSize="20%" maxSize="48%" defaultSize={showInspector ? initialLayout.current.chat : 28}>
        <PlannerComposer />
      </Panel>
      {showInspector && (
        <>
          <Separator className="chat-resize-handle" />
          <Panel id="inspector" minSize="14%" maxSize="34%" defaultSize={initialLayout.current.inspector}>
            <ReasoningInspectorPanel />
          </Panel>
        </>
      )}
    </Group>
  );
}
