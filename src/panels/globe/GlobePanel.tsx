import { useEffect, useRef, useState } from "react";
import { Cartesian3, Color, EllipsoidTerrainProvider, Viewer } from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

export function GlobePanel() {
  const host = useRef<HTMLDivElement>(null); const viewer = useRef<Viewer>(); const [error, setError] = useState<string>();
  useEffect(() => {
    if (!host.current || viewer.current) return;
    const start = async () => {
      try {
        viewer.current = new Viewer(host.current!, { animation: false, baseLayer: false, baseLayerPicker: false, geocoder: false, homeButton: true, infoBox: false, navigationHelpButton: false, sceneModePicker: false, selectionIndicator: false, skyAtmosphere: false, skyBox: false, timeline: false, terrainProvider: new EllipsoidTerrainProvider() });
        viewer.current.scene.backgroundColor = Color.fromCssColorString("#0a1514");
        viewer.current.scene.globe.baseColor = Color.fromCssColorString("#2a8270");
        viewer.current.scene.globe.enableLighting = false;
        viewer.current.camera.setView({ destination: Cartesian3.fromDegrees(-114.0719, 51.0447, 17_000_000) });
      } catch { setError("Globe services are unavailable. Check the Cesium asset bundle or network connection."); }
    };
    void start();
    return () => { viewer.current?.destroy(); viewer.current = undefined; };
  }, []);
  return <section className="globe-panel"><div className="panel-label"><span>GLOBE VIEW</span><small>WGS 84 · EPSG:4326</small></div><div className="cesium-host" ref={host} />{error && <div className="globe-error">{error}</div>}<div className="globe-hint">Drag to rotate · Scroll to zoom · Shift + drag to pan</div></section>;
}
