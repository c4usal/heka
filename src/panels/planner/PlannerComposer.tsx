import { ArrowUp, LoaderCircle, Play, Sparkles } from "lucide-react";
import { useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { executeFireStationAnalysis, type ExecutionProgress } from "../../execution/pyqgisExecution";
import { planWithOmniRoute } from "../../planner/omniRoutePlanner";
import { transformPlannerOutput } from "../../planner/planTransforms";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";

export function PlannerComposer() {
  const [question, setQuestion] = useState("Where should Calgary place a new emergency facility to improve coverage while avoiding flood risk?");
  const { planner, execution, beginPlanning, applyPlan, failPlanning, completeTimelineStep, beginExecution, updateExecution, completeExecution, failExecution } = useWorkspaceStore();
  const submit = async () => { if (!question.trim() || planner.status === "planning") return; beginPlanning();
    try { const output = await planWithOmniRoute(question); applyPlan(transformPlannerOutput(question, output)); [0, 1, 2, 3, 4, 5, 6].forEach((index) => window.setTimeout(() => completeTimelineStep(index), index * 260)); }
    catch (error) { failPlanning(error instanceof Error ? error.message : "The planner failed unexpectedly."); }
  };
  const execute = async () => { beginExecution(); let unlisten: (() => void) | undefined;
    try { unlisten = await listen<ExecutionProgress>("heka://execution-progress", (event) => updateExecution(event.payload.stage, event.payload.percent, event.payload.detail)); completeExecution(await executeFireStationAnalysis()); }
    catch (error) { failExecution(error instanceof Error ? error.message : "PyQGIS execution failed."); } finally { unlisten?.(); }
  };
  return <div className="planner-composer"><Sparkles size={16} /><textarea aria-label="Spatial question" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} /><button onClick={() => void submit()} disabled={planner.status === "planning"} title="Plan question">{planner.status === "planning" ? <LoaderCircle className="spin" size={17} /> : <ArrowUp size={17} />}</button><small>{planner.status === "planning" ? "OmniRoute is constructing a spatial plan..." : "Enter to plan · JSON-validated OmniRoute workflow"}</small>{planner.plan && <button className="execute-button" onClick={() => void execute()} disabled={execution.status === "running"}><Play size={13} /> {execution.status === "running" ? `${execution.progress}% ${execution.stage ?? "running"}` : "Run Calgary analysis"}</button>}{planner.error && <p role="alert">{planner.error}</p>}{execution.error && <p role="alert">{execution.error}</p>}</div>;
}
