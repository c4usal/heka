import { Group, Panel, Separator } from "react-resizable-panels";
import { FilePlus2, Map, Plus, X } from "lucide-react";
import { useState } from "react";
import { GlobePanel } from "../panels/globe/GlobePanel";
import { PlannerComposer } from "../panels/planner/PlannerComposer";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";

type Tab = { id: string; label: string; kind: "map" | "document" };

export function WorkspaceLayout() {
  const layout = useWorkspaceStore((state) => state.workspace.layout);
  const setHorizontalLayout = useWorkspaceStore((state) => state.setHorizontalLayout);
  const [tabs, setTabs] = useState<Tab[]>([{ id: "map", label: "Calgary map", kind: "map" }]);
  const [activeTab, setActiveTab] = useState("map");
  const addTab = () => {
    const id = `analysis-${Date.now()}`;
    setTabs((current) => [...current, { id, label: "New analysis", kind: "document" }]);
    setActiveTab(id);
  };
  const closeTab = (id: string) => {
    if (id === "map") return;
    setTabs((current) => current.filter((tab) => tab.id !== id));
    setActiveTab("map");
  };

  return <Group className="cursor-workspace" orientation="horizontal" defaultLayout={{ canvas: 100 - layout.right, chat: layout.right }} onLayoutChanged={(sizes) => setHorizontalLayout({ left: 0, center: sizes.canvas, right: sizes.chat })}>
    <Panel id="canvas" minSize="42%">
      <section className="tab-workspace">
        <header className="tab-strip" aria-label="Workspace tabs">
          {tabs.map((tab) => <button className={`workspace-tab ${activeTab === tab.id ? "active" : ""}`} key={tab.id} onClick={() => setActiveTab(tab.id)}>
            {tab.kind === "map" ? <Map size={14} /> : <FilePlus2 size={14} />}<span>{tab.label}</span>{tab.kind !== "map" && <X size={13} onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }} />}
          </button>)}
          <button className="new-tab" onClick={addTab} title="Open a new workspace tab"><Plus size={16} /></button>
        </header>
        <div className="tab-content">
          {activeTab === "map" ? <GlobePanel /> : <div className="empty-tab"><FilePlus2 size={26} /><strong>New analysis</strong><span>Keep your maps, notes, and generated reports in tabs alongside the persistent globe.</span></div>}
        </div>
      </section>
    </Panel>
    <Separator className="chat-resize-handle" />
    <Panel id="chat" minSize="280px" maxSize="48%">
      <PlannerComposer />
    </Panel>
  </Group>;
}
