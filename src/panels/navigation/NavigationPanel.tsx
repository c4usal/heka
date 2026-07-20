import { Boxes, ChevronLeft, Database, FolderKanban, History, Layers3, PlugZap } from "lucide-react";
import type { NavigationSection } from "../../types/workspace";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";

const items: Array<{ id: NavigationSection; label: string; icon: typeof FolderKanban }> = [
  { id: "projects", label: "Projects", icon: FolderKanban }, { id: "datasets", label: "Datasets", icon: Database }, { id: "layers", label: "Layers", icon: Layers3 }, { id: "history", label: "Analysis History", icon: History }, { id: "plugins", label: "Plugins", icon: PlugZap }
];

export function NavigationPanel() {
  const { workspace, datasets, setSection, toggleSidebar } = useWorkspaceStore();
  return <aside className={`navigation-panel ${workspace.isSidebarCollapsed ? "collapsed" : ""}`}><header className="brand"><Boxes size={19} /><div><strong>Heka</strong><span>SPATIAL REASONING IDE</span></div><button onClick={toggleSidebar} title="Collapse navigation"><ChevronLeft size={16} /></button></header>
    <nav>{items.map(({ id, label, icon: Icon }) => <button className={workspace.activeSection === id ? "active" : ""} key={id} onClick={() => setSection(id)} title={label}><Icon size={16} /><span>{label}</span>{id === "datasets" && <em>{datasets.length}</em>}</button>)}</nav>
    <footer><span>ACTIVE PROJECT</span><strong>{workspace.activeProject.name}</strong><small>{workspace.activeProject.updatedAt} · local workspace</small></footer>
  </aside>;
}
