import { Group, Panel, Separator } from "react-resizable-panels";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { NavigationPanel } from "../panels/navigation/NavigationPanel";
import { GlobePanel } from "../panels/globe/GlobePanel";
import { ReasoningInspectorPanel } from "../panels/inspector/ReasoningInspectorPanel";
import { ReplayTimelinePanel } from "../panels/timeline/ReplayTimelinePanel";

export function WorkspaceLayout() {
  const { workspace, setHorizontalLayout, setBottomSize } = useWorkspaceStore(); const { layout } = workspace;
  return <Group className="vertical-workspace" orientation="vertical" defaultLayout={{ main: 100 - layout.bottom, timeline: layout.bottom }} onLayoutChanged={(sizes) => setBottomSize(sizes.timeline)}><Panel id="main" minSize="55%"><Group className="horizontal-workspace" orientation="horizontal" defaultLayout={{ left: layout.left, center: layout.center, right: layout.right }} onLayoutChanged={(sizes) => setHorizontalLayout({ left: sizes.left, center: sizes.center, right: sizes.right })}><Panel id="left" minSize="8%" maxSize="30%"><NavigationPanel /></Panel><Separator className="resize-handle horizontal" /><Panel id="center" minSize="38%"><GlobePanel /></Panel><Separator className="resize-handle horizontal" /><Panel id="right" minSize="18%" maxSize="37%"><ReasoningInspectorPanel /></Panel></Group></Panel><Separator className="resize-handle vertical" /><Panel id="timeline" minSize="14%" maxSize="45%"><ReplayTimelinePanel /></Panel></Group>;
}
