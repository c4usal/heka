import { Braces, CheckSquare, FileText, ListTree, MapPin, NotebookPen, PlayCircle } from "lucide-react";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { discoverOpenStreetMapDataset } from "../../datasets/datasetResolver";
import { useState } from "react";

function EmptyInspector() { const cards = [["Intent", FileText, "No objective selected"], ["Constraints", CheckSquare, "No constraints extracted"], ["Selected datasets", ListTree, "Choose datasets to begin"], ["Workflow graph", Braces, "Awaiting planner output"], ["Planner notes", NotebookPen, "Planner ready"], ["Execution status", PlayCircle, "Runtime ready"]] as const; return <>{cards.map(([title, Icon, placeholder]) => <section className="inspector-card" key={title}><div><Icon size={14} /><h2>{title}</h2></div><p>{placeholder}</p></section>)}</>; }

export function ReasoningInspectorPanel() {
  const planner = useWorkspaceStore((state) => state.planner); const execution = useWorkspaceStore((state) => state.execution); const datasetResolutions = useWorkspaceStore((state) => state.datasetResolutions); const plan = planner.plan;
  const [discovery, setDiscovery] = useState<Record<string, string>>({});
  const inspectSource = async (datasetName: string) => {
    if (!plan) return;
    setDiscovery((current) => ({ ...current, [datasetName]: "Searching OpenStreetMap…" }));
    try { const result = await discoverOpenStreetMapDataset(datasetName, plan.geographicScope); setDiscovery((current) => ({ ...current, [datasetName]: `${result.featureCount.toLocaleString()} features found via ${result.sourceName}.` })); }
    catch (error) { setDiscovery((current) => ({ ...current, [datasetName]: error instanceof Error ? error.message : "Source discovery failed." })); }
  };
  return <aside className="inspector-panel"><header><span>REASONING INSPECTOR</span><strong>{planner.status === "planning" ? "Planning spatial workflow" : plan ? "Validated spatial plan" : "Workspace context"}</strong></header>{!plan ? <EmptyInspector /> : <>
    <section className="inspector-card"><div><FileText size={14} /><h2>Intent</h2></div><p>{plan.objective}</p><p className="detail"><MapPin size={11} /> {plan.location ?? plan.geographicScope}</p></section>
    <section className="inspector-card"><div><ListTree size={14} /><h2>Selected datasets</h2></div>{plan.requiredDatasets.map((dataset) => <p className="detail" key={dataset.name}><b>{dataset.name}</b> · {dataset.purpose}</p>)}</section>
    <section className="inspector-card"><div><ListTree size={14} /><h2>Dataset resolver</h2></div>{datasetResolutions.map((resolution) => <p className="detail" key={resolution.id}><b>{resolution.datasetName}</b> Â· {resolution.status === "workspace" ? "Ready locally" : resolution.status === "discoverable" ? `Discoverable via ${resolution.sourceName}` : `Needs data from ${resolution.sourceName}`}<br /><small>{resolution.detail}</small>{resolution.status === "discoverable" && <><br /><button className="source-discovery" onClick={() => void inspectSource(resolution.datasetName)}>Check source</button>{discovery[resolution.datasetName] && <small>{discovery[resolution.datasetName]}</small>}</>}</p>)}</section>
    <section className="inspector-card"><div><CheckSquare size={14} /><h2>Constraints & assumptions</h2></div>{plan.constraints.map((constraint) => <p className="detail" key={constraint.label}><b>{constraint.label}</b>: {constraint.value}</p>)}{plan.assumptions.map((assumption) => <p className="detail" key={assumption}>Assumes: {assumption}</p>)}</section>
    <section className="inspector-card"><div><NotebookPen size={14} /><h2>Workflow summary</h2></div><p>{plan.workflowSummary}</p><p className="detail">Confidence: <b>{plan.confidence}%</b></p></section>
    <section className="inspector-card"><div><Braces size={14} /><h2>Spatial DSL</h2></div><pre>{plan.dsl.map((step) => `${step.operation}(${step.inputs.join(", ") || "..."})`).join("\n")}</pre></section>
    <section className="inspector-card"><div><ListTree size={14} /><h2>Reasoning graph</h2></div><p className="detail">{plan.graph.nodes.map((node) => node.label).join(" → ")}</p></section>
    <section className="inspector-card"><div><PlayCircle size={14} /><h2>PyQGIS execution</h2></div><p className="detail">{execution.status === "running" ? `${execution.progress}% · ${execution.detail ?? "Processing"}` : execution.status === "complete" ? `${execution.result?.layerName} · ${execution.result?.featureCount} features · ${execution.result?.elapsedMs} ms` : execution.error ?? "Ready to execute the validated workflow."}</p>{execution.result?.warnings.map((warning) => <p className="detail" key={warning}>Warning: {warning}</p>)}</section>
    {execution.selectedFeature && <section className="inspector-card selected-feature"><div><MapPin size={14} /><h2>Selected map feature</h2></div><p className="detail"><b>{execution.selectedFeature.layerName}</b></p>{Object.entries(execution.selectedFeature.properties).map(([name, value]) => <p className="detail" key={name}><b>{name}</b>: {String(value)}</p>)}</section>}
    {plan.clarificationQuestions.length > 0 && <section className="inspector-card"><div><PlayCircle size={14} /><h2>Clarifications</h2></div>{plan.clarificationQuestions.map((question) => <p className="detail" key={question}>{question}</p>)}</section>}
  </>}</aside>;
}
