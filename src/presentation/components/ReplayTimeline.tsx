import { Play, RotateCcw } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";

const stages = ["Intent", "Dataset selection", "Workflow generation", "Validation", "Execution", "Visualization", "Explanation"];
export function ReplayTimeline() {
  const { events, workflow } = useWorkspaceStore();
  const done = new Set(events.map((event) => event.stage));
  return <section className="timeline"><header><div><span>WORKFLOW REPLAY</span><h2>{workflow ? "Analysis timeline" : "No analysis yet"}</h2></div><div><button title="Restart replay"><RotateCcw size={15} /></button><button className="primary"><Play size={15} /> Replay</button></div></header>
    <div className="stages">{stages.map((stage, index) => <div key={stage} className={index === 0 || done.size > index - 1 ? "complete" : ""}><i>{index + 1}</i><span>{stage}</span></div>)}</div>
  </section>;
}
