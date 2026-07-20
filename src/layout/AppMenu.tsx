import { Bell, ChevronDown, Command, FolderOpen, LayoutPanelTop, Search, Settings2, Sparkles } from "lucide-react";

const menuItems = ["File", "Edit", "Selection", "View", "Go", "Run", "Terminal", "Help"];

export function AppMenu() {
  return <>
    <header className="menu-bar">
      <div className="app-mark" aria-label="Heka"><Sparkles size={15} /></div>
      <nav aria-label="Application menu">{menuItems.map((item) => <button key={item}>{item}</button>)}</nav>
      <label className="command-search"><Search size={14} /><input aria-label="Command search" placeholder="Search Heka commands" /><kbd>⌘ P</kbd></label>
      <div className="window-actions"><button title="Open project"><FolderOpen size={15} /></button><button title="Workspace layout"><LayoutPanelTop size={15} /></button><button title="Notifications"><Bell size={15} /></button><button title="Settings"><Settings2 size={15} /></button></div>
    </header>
    <div className="toolbar">
      <div className="workspace-crumb"><span>WORKSPACE</span><strong>Calgary coverage study</strong><ChevronDown size={13} /></div>
      <div className="toolbar-divider" />
      <button><Command size={13} /> Command palette</button>
      <button>Import data</button>
      <i />
      <small><span className="status-dot" /> Local runtime</small>
    </div>
  </>;
}
