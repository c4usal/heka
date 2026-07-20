import { CheckCircle2, CircleDotDashed, FileSearch, ShieldCheck } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";

export function ReasoningInspector() {
  const { workflow, graph, datasets, isPlanning } = useWorkspaceStore();
  const constraints = workflow?.intent.constraints ?? [];
  return <aside className="inspector"><header><div><span>REASONING INSPECTOR</span><h2>{isPlanning ? "Constructing workflow" : workflow ? "Validated analysis" : "Ready to plan"}</h2></div><ShieldCheck size={19} /></header>
    <section><h3><CircleDotDashed size={15} />Objective</h3><p>{workflow?.intent.objective ?? "Ask a spatial question to begin."}</p></section>
    <section><h3><FileSearch size={15} />Evidence</h3>{datasets.map((dataset) => <div className="evidence" key={dataset.id}><CheckCircle2 size={14} /><span>{dataset.name}</span><small>{dataset.source}</small></div>)}</section>
    <section><h3>Constraints</h3>{constraints.length ? constraints.map((constraint) => <div className="chip" key={constraint.id}>{constraint.label}: <b>{constraint.value}</b></div>) : <p className="muted">No constraints extracted yet.</p>}</section>
    <section><h3>Workflow graph</h3><div className="graph">{graph?.nodes.slice(0, 7).map((node, index) => <div key={node.id}><span>{node.label}</span>{index < Math.min(graph.nodes.length, 7) - 1 && <i />}</div>) ?? <p className="muted">The inspectable reasoning graph will appear here.</p>}</div></section>
  </aside>;
}
