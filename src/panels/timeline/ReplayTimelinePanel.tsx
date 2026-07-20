import { Pause, Play, RotateCcw } from "lucide-react";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
export function ReplayTimelinePanel() {
  const { timeline, setTimelinePlaying } = useWorkspaceStore();
  return <section className="timeline-panel"><header><div><span>REPLAY TIMELINE</span><h2>Planning replay · {timeline.progress}%</h2></div><div className="timeline-actions"><button title="Reset replay"><RotateCcw size={15} /></button><button onClick={() => setTimelinePlaying(!timeline.isPlaying)} className="play-button">{timeline.isPlaying ? <Pause size={14} /> : <Play size={14} />} {timeline.isPlaying ? "Pause" : "Play"}</button></div></header><div className="timeline-track">{timeline.steps.map((step, index) => <div key={step.id} className={step.status}><i>{index + 1}</i><span>{step.label}</span>{index < timeline.steps.length - 1 && <b />}</div>)}</div><div className="timeline-empty">{timeline.progress ? "Planner output is ready to inspect." : "Submit a spatial question to begin the planning replay."}</div></section>;
}
