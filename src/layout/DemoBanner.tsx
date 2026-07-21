import { ExternalLink } from "lucide-react";
import { isWebRuntime } from "../config/aiGateway";

/** Web-only demo strip — replaces the File/Edit desktop menu chrome. */
export function DemoBanner() {
  if (!isWebRuntime()) return null;

  return (
    <header className="demo-banner" role="banner">
      <p className="demo-banner-copy">
        This is just a <strong>web demo</strong> of the full Spatial Reasoning IDE.
        {" "}
        <a className="demo-banner-link" href="#/download">
          Download it here <ExternalLink size={12} />
        </a>
      </p>
    </header>
  );
}
