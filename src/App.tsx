import { useEffect, useState } from "react";
import { AppMenu } from "./layout/AppMenu";
import { DemoBanner } from "./layout/DemoBanner";
import { WorkspaceLayout } from "./layout/WorkspaceLayout";
import { DownloadPage } from "./pages/DownloadPage";
import { isWebRuntime } from "./config/aiGateway";

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash.replace(/^#/, "") || "/");
  useEffect(() => {
    const onHash = () => setHash(window.location.hash.replace(/^#/, "") || "/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return hash.startsWith("/") ? hash : `/${hash}`;
}

export default function App() {
  const route = useHashRoute();
  const web = isWebRuntime();

  if (web && route.startsWith("/download")) {
    return <div className="desktop-app download-shell"><DownloadPage /></div>;
  }

  return (
    <div className="desktop-app">
      {web ? <DemoBanner /> : <AppMenu />}
      <main className="workspace-root"><WorkspaceLayout /></main>
    </div>
  );
}
