import { ArrowLeft, Download, Monitor } from "lucide-react";
import { hekaLogo as logo } from "../assets/hekaLogo";

const RELEASE_TAG = "v0.1.0";
const WINDOWS_SETUP =
  `https://github.com/c4usal/heka/releases/download/${RELEASE_TAG}/Heka_0.1.0_x64-setup.exe`;
const WINDOWS_MSI =
  `https://github.com/c4usal/heka/releases/download/${RELEASE_TAG}/Heka_0.1.0_x64_en-US.msi`;
const WINDOWS_ZIP =
  `https://github.com/c4usal/heka/releases/download/${RELEASE_TAG}/Heka_0.1.0_Windows_x64.zip`;
const RELEASES = "https://github.com/c4usal/heka/releases/latest";
const REPO = "https://github.com/c4usal/heka";

/**
 * Windows download landing (web demo → full IDE).
 * Mac is intentionally not offered yet.
 */
export function DownloadPage() {
  return (
    <div className="download-page">
      <a className="download-back" href="#/">
        <ArrowLeft size={16} /> Back to web demo
      </a>
      <div className="download-hero">
        <img src={logo} alt="Heka" className="download-logo" />
        <h1>Download Heka for Windows</h1>
        <p>
          The full Spatial Reasoning IDE — multi-document tabs, spatial imports, QGIS Processing,
          and the same Earth Agent brain as this web demo.
        </p>
        <p className="download-os">
          <Monitor size={16} /> Windows x64 · macOS coming later
        </p>
        <div className="download-actions">
          <a className="download-primary" href={WINDOWS_SETUP} download>
            <Download size={18} /> Download Windows installer
          </a>
          <a className="download-secondary" href={WINDOWS_ZIP}>
            Download ZIP
          </a>
          <a className="download-secondary" href={REPO} target="_blank" rel="noreferrer">
            View source on GitHub
          </a>
        </div>
        <p className="download-meta">
          Also available:{" "}
          <a href={WINDOWS_MSI}>MSI</a>
          {" · "}
          <a href={RELEASES} target="_blank" rel="noreferrer">All releases</a>
        </p>
      </div>
      <section className="download-details">
        <h2>What you get in the full IDE</h2>
        <ul>
          <li>Packaged Windows app with the Heka logo</li>
          <li>Multi-document workspace tabs</li>
          <li>Drag-drop GeoJSON / KML / CSV and richer GIS imports</li>
          <li>Optional local QGIS Processing for Buffer / Coverage / Difference</li>
          <li>Same Ask Earth Agent (web search + open data + scoring)</li>
        </ul>
        <h2>Install tips</h2>
        <p>
          Prefer the NSIS setup (<code>Heka_0.1.0_x64-setup.exe</code>). The ZIP is a portable
          copy of the same installer for offline sharing. Install{" "}
          <a href="https://qgis.org" target="_blank" rel="noreferrer">QGIS LTR</a>{" "}
          if you want local Processing.
        </p>
        <p className="download-note">
          After install, launch <strong>Heka</strong> from the Start menu. The web demo stays
          available at this site if you only need Ask Earth in the browser.
        </p>
      </section>
    </div>
  );
}
