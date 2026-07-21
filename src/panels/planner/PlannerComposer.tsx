import { ArrowUp, ChevronRight, CircleAlert, Cpu, LoaderCircle, Sparkles } from "lucide-react";
import { useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { hekaLogo as logo } from "../../assets/hekaLogo";
import { executeSpatialPlan, type ExecutionProgress } from "../../execution/pyqgisExecution";
import { planWithOmniRoute } from "../../planner/omniRoutePlanner";
import { transformPlannerOutput } from "../../planner/planTransforms";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import type { PlannerPlan } from "../../types/workspace";

export function PlannerComposer() {
  const [question, setQuestion] = useState("");
  const [submittedQuestion, setSubmittedQuestion] = useState<string>();
  const { planner, execution, beginPlanning, applyPlan, failPlanning, completeTimelineStep, beginExecution, updateExecution, completeExecution, failExecution } = useWorkspaceStore();
  const execute = async (plan: PlannerPlan) => {
    beginExecution(); let unlisten: (() => void) | undefined;
    try { unlisten = await listen<ExecutionProgress>("heka://execution-progress", (event) => updateExecution(event.payload.stage, event.payload.percent, event.payload.detail)); completeExecution(await executeSpatialPlan(plan)); }
    catch (error) { failExecution(error instanceof Error ? error.message : "PyQGIS execution failed."); } finally { unlisten?.(); }
  };
  const submit = async () => {
    const prompt = question.trim();
    if (!prompt || planner.status === "planning") return;
    setSubmittedQuestion(prompt); setQuestion(""); beginPlanning();
    try {
      const output = await planWithOmniRoute(prompt);
      const plan = transformPlannerOutput(prompt, output);
      applyPlan(plan);
      [0, 1, 2, 3, 4, 5, 6].forEach((index) => window.setTimeout(() => completeTimelineStep(index), index * 180));
      if (plan.executionReadiness === "ready") await execute(plan);
    } catch (error) { failPlanning(error instanceof Error ? error.message : "The planner failed unexpectedly."); }
  };
  const plan = planner.plan;
  return <aside className="chat-panel">
    <header className="chat-header"><div><img src={logo} alt="" /><span>New agent</span></div><button>Auto <ChevronRight size={13} /></button></header>
    <div className="chat-thread">
      {!submittedQuestion && !plan && <div className="chat-welcome"><div className="welcome-mark"><img src={logo} alt="Heka" /></div><h1>Ask Earth</h1><p>Plan, inspect, and run spatial analysis without opening a GIS tool.</p><p className="welcome-hint">Heka checks each question against the datasets that are actually available before it runs QGIS.</p></div>}
      {submittedQuestion && <article className="user-message">{submittedQuestion}</article>}
      {planner.status === "planning" && <article className="assistant-message thinking-live"><LoaderCircle className="spin" size={15} /> Building a spatial plan…</article>}
      {planner.error && <article className="chat-error"><CircleAlert size={15} /><span>{planner.error}</span></article>}
      {plan && <article className="assistant-message"><p className="assistant-kicker"><Sparkles size={13} /> Spatial plan ready</p><h2>{plan.objective}</h2><p>{plan.workflowSummary}</p><div className="plan-meta"><span>{plan.location ?? plan.geographicScope}</span><span>{plan.confidence}% confidence</span></div>
        <details className="thinking-details"><summary><Cpu size={14} /><span>Thinking</span><small>{plan.dsl.length} spatial steps</small><ChevronRight size={14} /></summary><div className="thinking-body"><p><b>Datasets</b>{plan.requiredDatasets.map((dataset) => <span key={dataset.name}>{dataset.name}</span>)}</p><p><b>Workflow</b>{plan.dsl.map((step) => <span key={step.id}>{step.operation} — {step.label}</span>)}</p><p><b>Assumptions</b>{plan.assumptions.map((assumption) => <span key={assumption}>{assumption}</span>)}</p></div></details>
        <p className="execution-state">{execution.status === "running" ? `${execution.progress}% · ${execution.detail ?? execution.stage ?? "Executing with QGIS"}` : execution.status === "complete" ? `Mapped ${execution.result?.featureCount ?? 0} generated locations` : "Validating spatial plan"}</p>
        {plan.clarificationQuestions.length > 0 && <div className="planner-clarifications">{plan.clarificationQuestions.map((item) => <p key={item}>{item}</p>)}</div>}
        {execution.error && <p className="inline-error">{execution.error}</p>}
      </article>}
    </div>
    <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}><textarea aria-label="Spatial question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask a question about the physical world…" rows={3} /><div><span>Enter to send · Shift+Enter for a new line</span><button type="submit" disabled={!question.trim() || planner.status === "planning"} title="Plan question"><ArrowUp size={17} /></button></div></form>
  </aside>;
}
