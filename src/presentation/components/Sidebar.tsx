import { Boxes, Database, FolderKanban, History, Layers3, PlugZap } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";

const navigation = [
  ["projects", "Projects", FolderKanban], ["datasets", "Datasets", Database], ["layers", "Layers", Layers3], ["plugins", "Plugins", PlugZap], ["history", "History", History]
] as const;

export function Sidebar() {
  const { activePanel, setActivePanel, datasets } = useWorkspaceStore();
  return <aside className="sidebar"><div className="brand"><Boxes size={20} /><span>Heka</span><small>Spatial Reasoning IDE</small></div>
    <nav>{navigation.map(([id, label, Icon]) => <button key={id} className={activePanel === id ? "active" : ""} onClick={() => setActivePanel(id)}><Icon size={16} />{label}{id === "datasets" && <em>{datasets.length}</em>}</button>)}</nav>
    <div className="project-card"><span>ACTIVE PROJECT</span><strong>Calgary Infrastructure Study</strong><p>4 datasets · local workspace</p></div>
  </aside>;
}
