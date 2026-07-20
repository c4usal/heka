import { Crosshair, Layers2, MapPinned, Plus, ZoomIn, ZoomOut } from "lucide-react";

/** Cesium adapter point. It is intentionally isolated so the workspace has no map-vendor coupling. */
export function Globe() {
  return <main className="globe" aria-label="Spatial analysis map">
    <div className="map-grid" /><div className="landmass landmass-one" /><div className="landmass landmass-two" />
    <div className="candidate candidate-a"><i />Candidate A<span>High coverage</span></div><div className="candidate candidate-b"><i />Candidate B<span>Low flood risk</span></div>
    <div className="map-legend"><b>CALGARY, AB</b><span><i className="road" />Road network</span><span><i className="risk" />Flood exclusion</span><span><i className="coverage" />Coverage gap</span></div>
    <div className="map-controls"><button><ZoomIn size={16} /></button><button><ZoomOut size={16} /></button><button><Crosshair size={16} /></button><button><Layers2 size={16} /></button><button><MapPinned size={16} /></button><button><Plus size={16} /></button></div>
    <div className="map-watermark">HEKA / LOCAL SPATIAL WORKSPACE</div>
  </main>;
}
