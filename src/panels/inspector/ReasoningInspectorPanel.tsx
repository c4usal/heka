import { Braces, CheckSquare, FileText, ListTree, NotebookPen, PlayCircle } from "lucide-react";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";

const cards = [
  ["Intent", FileText, "No objective selected"], ["Constraints", CheckSquare, "No constraints extracted"], ["Selected datasets", ListTree, "Choose datasets to begin"], ["Workflow graph", Braces, "Awaiting planner output"], ["Planner notes", NotebookPen, "Planner ready"], ["Execution status", PlayCircle, "Runtime ready"]
] as const;
export function ReasoningInspectorPanel() {
  const { runtime } = useWorkspaceStore();
  return <aside className="inspector-panel"><header><span>REASONING INSPECTOR</span><strong>Workspace context</strong></header>{cards.map(([title, Icon, placeholder]) => <section className="inspector-card" key={title}><div><Icon size={14} /><h2>{title}</h2></div><p>{title === "Execution status" ? runtime.backend : placeholder}</p></section>)}</aside>;
}
