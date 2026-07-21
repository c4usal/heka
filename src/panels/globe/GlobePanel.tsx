import { useEffect, useRef, useState } from "react";
import { Cartesian3, Color, ColorMaterialProperty, ConstantProperty, EllipsoidTerrainProvider, GeoJsonDataSource, ImageryLayer, JulianDate, OpenStreetMapImageryProvider, ScreenSpaceEventType, Viewer } from "cesium";
import "./mapViewer.css";
import { Crosshair, Eye, EyeOff, Layers } from "lucide-react";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import type { MapLayer, MapLayerKind } from "../../types/workspace";

type SourceRecord = { layer: MapLayer; source: GeoJsonDataSource; visible: boolean };
const styles: Record<MapLayerKind, { fill: Color; stroke: Color; marker: Color; size: number }> = {
  stations: { fill: Color.fromCssColorString("#22d3ee").withAlpha(0.18), stroke: Color.fromCssColorString("#0891b2"), marker: Color.fromCssColorString("#06b6d4"), size: 10 },
  coverage: { fill: Color.fromCssColorString("#34d399").withAlpha(0.18), stroke: Color.fromCssColorString("#059669"), marker: Color.fromCssColorString("#059669"), size: 8 },
  gaps: { fill: Color.fromCssColorString("#f97316").withAlpha(0.3), stroke: Color.fromCssColorString("#ea580c"), marker: Color.fromCssColorString("#ea580c"), size: 8 },
  candidates: { fill: Color.fromCssColorString("#facc15").withAlpha(0.3), stroke: Color.fromCssColorString("#ca8a04"), marker: Color.fromCssColorString("#facc15"), size: 13 },
  generic: { fill: Color.fromCssColorString("#60a5fa").withAlpha(0.25), stroke: Color.fromCssColorString("#2563eb"), marker: Color.fromCssColorString("#60a5fa"), size: 9 },
};

export function GlobePanel() {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer>();
  const sources = useRef<SourceRecord[]>([]);
  const selectedEntity = useRef<any>();
  const result = useWorkspaceStore((state) => state.execution.result);
  const resolvedMapLayers = useWorkspaceStore((state) => state.resolvedMapLayers);
  const selectMapFeature = useWorkspaceStore((state) => state.selectMapFeature);
  const [error, setError] = useState<string>();
  const [layers, setLayers] = useState<SourceRecord[]>([]);

  useEffect(() => {
    if (!host.current || viewer.current) return;
    try {
      const instance = new Viewer(host.current, {
        animation: false, baseLayer: new ImageryLayer(new OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" })), baseLayerPicker: false,
        geocoder: false, homeButton: false, fullscreenButton: false, infoBox: false, navigationHelpButton: false, sceneModePicker: false, selectionIndicator: false,
        skyAtmosphere: false, skyBox: false, timeline: false, terrainProvider: new EllipsoidTerrainProvider(),
      });
      instance.scene.backgroundColor = Color.fromCssColorString("#0a1514");
      instance.scene.globe.baseColor = Color.fromCssColorString("#2a8270");
      instance.scene.globe.enableLighting = false;
      // Explicitly look down at Calgary. Leaving orientation unspecified retains
      // Cesium's prior camera direction and can point the initial view into space.
      instance.camera.setView({ destination: Cartesian3.fromDegrees(-114.0719, 51.0447, 2_000_000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
      instance.screenSpaceEventHandler.setInputAction(((movement: { position: any }) => {
        const picked = instance.scene.pick(movement.position) as { id?: any } | undefined;
        const entity = picked?.id;
        if (!entity?.properties) { selectMapFeature(); return; }
        if (selectedEntity.current?.point) selectedEntity.current.point.pixelSize = new ConstantProperty(13);
        if (selectedEntity.current?.polygon) selectedEntity.current.polygon.outlineWidth = new ConstantProperty(1.5);
        if (entity.point) entity.point.pixelSize = new ConstantProperty(19);
        if (entity.polygon) entity.polygon.outlineWidth = new ConstantProperty(4);
        selectedEntity.current = entity;
        const now = JulianDate.now();
        const properties = entity.properties.propertyNames.reduce((all: Record<string, unknown>, key: string) => {
          const value = entity.properties[key]?.getValue(now);
          all[key] = typeof value === "object" ? JSON.stringify(value) : value;
          return all;
        }, {});
        selectMapFeature({ layerName: (entity as { __hekaLayerName?: string }).__hekaLayerName ?? "GIS feature", featureId: entity.id, properties });
      }) as any, ScreenSpaceEventType.LEFT_CLICK);
      viewer.current = instance;
    } catch { setError("Globe services are unavailable. Check the Cesium asset bundle or network connection."); }
    return () => { viewer.current?.destroy(); viewer.current = undefined; sources.current = []; };
  }, [selectMapFeature]);

  useEffect(() => {
    if (!viewer.current || (!result && resolvedMapLayers.length === 0)) return;
    viewer.current.dataSources.removeAll(); sources.current = []; setLayers([]); selectMapFeature();
    const executionLayers = !result ? [] : result.mapLayers?.length ? result.mapLayers : [{ id: "candidates", name: result.layerName, kind: "candidates" as const, geojson: result.geojson, featureCount: result.featureCount, outputPath: result.outputPath }];
    const mapLayers = [...resolvedMapLayers, ...executionLayers];
    void Promise.all(mapLayers.map(async (layer) => {
      const style = styles[layer.kind];
      const source = await GeoJsonDataSource.load(JSON.parse(layer.geojson), { clampToGround: true, fill: style.fill, stroke: style.stroke, strokeWidth: 1.5, markerColor: style.marker, markerSize: style.size });
      source.name = layer.name;
      source.entities.values.forEach((entity) => {
        (entity as typeof entity & { __hekaLayerName?: string }).__hekaLayerName = layer.name;
        if (entity.point) { entity.point.color = new ConstantProperty(style.marker); entity.point.pixelSize = new ConstantProperty(style.size); entity.point.outlineColor = new ConstantProperty(Color.WHITE); entity.point.outlineWidth = new ConstantProperty(2); }
        if (entity.polygon) { entity.polygon.material = new ColorMaterialProperty(style.fill); entity.polygon.outlineColor = new ConstantProperty(style.stroke); entity.polygon.outlineWidth = new ConstantProperty(1.5); }
        if (entity.polyline) { entity.polyline.material = new ColorMaterialProperty(style.stroke); entity.polyline.width = new ConstantProperty(3); }
      });
      viewer.current?.dataSources.add(source);
      return { layer, source, visible: true };
    })).then((records) => {
      sources.current = records; setLayers(records);
      void viewer.current?.flyTo(records.find((record) => record.layer.kind === "gaps")?.source ?? records[0].source, { duration: 1.1 });
    }).catch(() => setError("Heka could not display the generated QGIS GeoJSON layers."));
  }, [result, resolvedMapLayers, selectMapFeature]);

  const toggleLayer = (id: string) => setLayers((current) => current.map((record) => {
    if (record.layer.id !== id) return record;
    record.source.show = !record.visible;
    return { ...record, visible: !record.visible };
  }));

  const focusLayers = () => {
    const visible = layers.filter((record) => record.visible);
    const primary = visible.find((record) => record.layer.kind === "gaps") ?? visible.find((record) => record.layer.kind === "candidates") ?? visible[0];
    if (primary) void viewer.current?.flyTo(primary.source, { duration: 1.1 });
  };

  return <section className="globe-panel"><div className="panel-label"><span>GLOBE VIEW</span><small>QGIS OUTPUT · WGS 84 / EPSG:4326</small></div><div className="cesium-host" ref={host} />
    {layers.length > 0 && <aside className="map-layers"><button className="layers-focus" onClick={focusLayers} title="Zoom to visible QGIS output layers"><Layers size={12} /> QGIS layers <Crosshair size={11} /></button>{layers.map(({ layer, visible }) => <button key={layer.id} onClick={() => toggleLayer(layer.id)} title={`${layer.outputPath} · ${layer.featureCount} features`}><span className={`layer-swatch ${layer.kind}`} />{visible ? <Eye size={12} /> : <EyeOff size={12} />}<b>{layer.name}</b><em>{layer.featureCount}</em></button>)}</aside>}
    {error && <div className="globe-error">{error}</div>}<div className="globe-hint">Drag to rotate · Scroll to zoom · Shift + drag to pan · Click a feature to inspect it</div></section>;
}
