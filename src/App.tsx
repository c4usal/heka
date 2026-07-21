import { AppMenu } from "./layout/AppMenu";
import { WorkspaceLayout } from "./layout/WorkspaceLayout";

export default function App() {
  return <div className="desktop-app"><AppMenu /><main className="workspace-root"><WorkspaceLayout /></main></div>;
}
