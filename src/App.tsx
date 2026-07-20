import { AppMenu } from "./layout/AppMenu";
import { WorkspaceLayout } from "./layout/WorkspaceLayout";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";

export default function App() {
  const runtime = useWorkspaceStore((state) => state.runtime);
  const setRuntime = useWorkspaceStore((state) => state.setRuntime);
  useEffect(() => { void checkPyQgisRuntime().then((health) => setRuntime({ status: health.available ? "ready" : "offline", backend: health.available ? health.backend : `QGIS unavailable: ${health.detail}` })).catch(() => setRuntime({ status: "offline", backend: "QGIS runtime check failed" })); }, [setRuntime]);
  return <div className="desktop-app"><AppMenu /><main className="workspace-root"><WorkspaceLayout /></main><footer className="status-bar"><span><i /> {runtime.status === "ready" ? "Runtime ready" : "Runtime offline"}</span><span>{runtime.backend}</span><span>Layout saved locally</span></footer></div>;
}
import { useEffect } from "react";
import { checkPyQgisRuntime } from "./execution/pyqgisExecution";
