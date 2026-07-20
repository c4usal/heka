import { ArrowUp, Command, Sparkles } from "lucide-react";
import { RulePlanner } from "./infrastructure/rulePlanner";
import { Sidebar } from "./presentation/components/Sidebar";
import { Globe } from "./presentation/components/Globe";
import { ReasoningInspector } from "./presentation/components/ReasoningInspector";
import { ReplayTimeline } from "./presentation/components/ReplayTimeline";
import { useWorkspaceStore } from "./presentation/store/workspaceStore";

const planner = new RulePlanner();
export default function App() {
  const { question, setQuestion, datasets, setPlan, setPlanning, isPlanning, addEvent } = useWorkspaceStore();
  const runPlan = async () => {
    if (!question.trim() || isPlanning) return;
    setPlanning(true);
    try {
      const { workflow, graph } = await planner.plan(question, datasets);
      setPlan(workflow, graph);
      const stages = ["validation", "compilation", "execution", "visualization", "complete"] as const;
      stages.forEach((stage, index) => addEvent({ workflowId: workflow.id, stage, label: stage[0].toUpperCase() + stage.slice(1), progress: (index + 1) / stages.length, timestamp: new Date().toISOString() }));
    } finally { setPlanning(false); }
  };
  return <div className="app-shell"><Sidebar /><section className="workbench"><div className="topbar"><span>CALGARY INFRASTRUCTURE STUDY <i>LOCAL</i></span><span>EPSG:4326 · WGS 84</span></div><Globe /><div className="prompt"><Sparkles size={17} /><textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void runPlan(); } }} /><button className="send" onClick={() => void runPlan()} disabled={isPlanning}><ArrowUp size={18} /></button><small><Command size={12} /> Enter to plan · Shift + Enter for a new line</small></div><ReplayTimeline /><footer><span><i className="status-dot" /> Runtime ready</span><span>PyQGIS adapter · local worker</span><span>Autosaved seconds ago</span></footer></section><ReasoningInspector /></div>;
}
