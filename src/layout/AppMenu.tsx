import { Command, PanelRight, Search, Sparkles } from "lucide-react";

export function AppMenu() {
  return <header className="menu-bar">
    <div className="app-mark" aria-label="Heka"><Sparkles size={15} /></div>
    <span className="app-name">Heka</span>
    <nav aria-label="Application menu"><button>File</button><button>Edit</button><button>View</button><button>Run</button></nav>
    <label className="command-search"><Search size={14} /><input aria-label="Command search" placeholder="Search Heka commands" /><kbd><Command size={10} /> P</kbd></label>
    <button className="chrome-icon" title="Toggle chat panel"><PanelRight size={16} /></button>
  </header>;
}
