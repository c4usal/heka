import { useEffect, useRef, useState } from "react";
import { Cartesian3, Color, ConstantProperty, EllipsoidTerrainProvider, GeoJsonDataSource, Viewer } from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { PlannerComposer } from "../planner/PlannerComposer";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";

export function GlobePanel() {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer>();
  const resultSources = useRef<GeoJsonDataSource[]>([]);
  const resultLayer = useWorkspaceStore((state) => state.execution.result);
  const [error, setError] = useState<string>();
  const [resultsVisible, setResultsVisible] = useState(true);

  useEffect(() => {
    if (!host.current || viewer.current) return;
    try {
      viewer.current = new Viewer(host.current, { animation: false, baseLayer: false, baseLayerPicker: false, geocoder: false, homeButton: true, infoBox: false, navigationHelpButton: false, sceneModePicker: false, selectionIndicator: false, skyAtmosphere: false, skyBox: false, timeline: false, terrainProvider: new EllipsoidTerrainProvider() });
      viewer.current.scene.backgroundColor = Color.fromCssColorString("#0a1514");
      viewer.current.scene.globe.baseColor = Color.fromCssColorString("#2a8270");
      viewer.current.scene.globe.enableLighting = false;
      viewer.current.camera.setView({ destination: Cartesian3.fromDegrees(-114.0719, 51.0447, 17_000_000) });
    } catch { setError("Globe services are unavailable. Check the Cesium asset bundle or network connection."); }
    return () => { viewer.current?.destroy(); viewer.current = undefined; resultSources.current = []; };
  }, []);

  useEffect(() => {
    if (!viewer.current || !resultLayer) return;
    void GeoJsonDataSource.load(JSON.parse(resultLayer.geojson), { clampToGround: true }).then((loaded) => {
      loaded.name = resultLayer.layerName;
      loaded.show = resultsVisible;
      loaded.entities.values.forEach((entity) => {
        if (entity.point) { entity.point.color = new ConstantProperty(Color.fromCssColorString("#ffce6a")); entity.point.pixelSize = new ConstantProperty(11); entity.point.outlineColor = new ConstantProperty(Color.WHITE); entity.point.outlineWidth = new ConstantProperty(2); }
      });
      resultSources.current.push(loaded);
      viewer.current?.dataSources.add(loaded);
      viewer.current?.zoomTo(loaded);
    }).catch(() => setError("Heka could not display the generated GeoJSON layer."));
  }, [resultLayer]);

  useEffect(() => { resultSources.current.forEach((source) => { source.show = resultsVisible; }); }, [resultsVisible]);

  return <section className="globe-panel"><div className="panel-label"><span>GLOBE VIEW</span><small>WGS 84 · EPSG:4326</small></div><div className="cesium-host" ref={host} />{resultLayer && <button className="result-layer-toggle" onClick={() => setResultsVisible((visible) => !visible)}>{resultsVisible ? "Hide" : "Show"} candidates</button>}{error && <div className="globe-error">{error}</div>}<div className="globe-hint">Drag to rotate · Scroll to zoom · Shift + drag to pan</div><PlannerComposer /></section>;
}
