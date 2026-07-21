import { useEffect, useRef, useState } from "react";
import { Cartesian2, Cartesian3, Color, ColorMaterialProperty, ConstantProperty, EllipsoidTerrainProvider, GeoJsonDataSource, HeadingPitchRange, HorizontalOrigin, ImageryLayer, JulianDate, LabelStyle, NearFarScalar, OpenStreetMapImageryProvider, Rectangle, ScreenSpaceEventType, VerticalOrigin, Viewer } from "cesium";
import "./mapViewer.css";
import { Crosshair, Eye, EyeOff, Layers } from "lucide-react";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import type { MapLayer, MapLayerKind } from "../../types/workspace";

type SourceRecord = { layer: MapLayer; source: GeoJsonDataSource; visible: boolean };
const styles: Record<MapLayerKind, { fill: Color; stroke: Color; marker: Color; size: number; width: number }> = {
  stations: { fill: Color.fromCssColorString("#22d3ee").withAlpha(0.2), stroke: Color.fromCssColorString("#0891b2"), marker: Color.fromCssColorString("#06b6d4"), size: 14, width: 3 },
  coverage: { fill: Color.fromCssColorString("#14b8a6").withAlpha(0.22), stroke: Color.fromCssColorString("#0f766e"), marker: Color.fromCssColorString("#14b8a6"), size: 8, width: 2 },
  gaps: { fill: Color.fromCssColorString("#f97316").withAlpha(0.16), stroke: Color.fromCssColorString("#ea580c"), marker: Color.fromCssColorString("#ea580c"), size: 8, width: 2 },
  candidates: { fill: Color.fromCssColorString("#facc15").withAlpha(0.2), stroke: Color.fromCssColorString("#b45309"), marker: Color.fromCssColorString("#f59e0b"), size: 28, width: 3 },
  generic: { fill: Color.fromCssColorString("#60a5fa").withAlpha(0.12), stroke: Color.fromCssColorString("#2563eb"), marker: Color.fromCssColorString("#60a5fa"), size: 8, width: 2 },
  roads: { fill: Color.fromCssColorString("#94a3b8").withAlpha(0.06), stroke: Color.fromCssColorString("#334155"), marker: Color.fromCssColorString("#64748b"), size: 7, width: 1.8 },
  waterways: { fill: Color.fromCssColorString("#38bdf8").withAlpha(0.15), stroke: Color.fromCssColorString("#0369a1"), marker: Color.fromCssColorString("#0ea5e9"), size: 8, width: 3.5 },
  bridges: { fill: Color.fromCssColorString("#f472b6").withAlpha(0.2), stroke: Color.fromCssColorString("#be185d"), marker: Color.fromCssColorString("#db2777"), size: 12, width: 4 },
};

export function GlobePanel() {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer>();
  const sources = useRef<SourceRecord[]>([]);
  const selectedEntity = useRef<any>();
  const result = useWorkspaceStore((state) => state.execution.result);
  const resolvedMapLayers = useWorkspaceStore((state) => state.resolvedMapLayers);
  const mapFocus = useWorkspaceStore((state) => state.mapFocus);
  const cameraTarget = useWorkspaceStore((state) => state.cameraTarget);
  const selectMapFeature = useWorkspaceStore((state) => state.selectMapFeature);
  const setCameraTarget = useWorkspaceStore((state) => state.setCameraTarget);
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
      instance.camera.setView({ destination: Cartesian3.fromDegrees(-114.0719, 51.0447, 2_000_000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
      instance.screenSpaceEventHandler.setInputAction(((movement: { position: any }) => {
        const picked = instance.scene.pick(movement.position) as { id?: any } | undefined;
        const entity = picked?.id;
        if (!entity?.properties) { selectMapFeature(); return; }
        selectedEntity.current = entity;
        const now = JulianDate.now();
        const properties = entity.properties.propertyNames.reduce((all: Record<string, unknown>, key: string) => {
          const value = entity.properties[key]?.getValue(now);
          all[key] = typeof value === "object" ? JSON.stringify(value) : value;
          return all;
        }, {});
        selectMapFeature({ layerName: (entity as { __hekaLayerName?: string }).__hekaLayerName ?? "GIS feature", featureId: entity.id, properties });
        const position = entity.position?.getValue(now) as Cartesian3 | undefined;
        if (position) {
          const carto = instance.scene.globe.ellipsoid.cartesianToCartographic(position);
          if (carto) {
            setCameraTarget({
              lon: (carto.longitude * 180) / Math.PI,
              lat: (carto.latitude * 180) / Math.PI,
              height: 28_000,
              label: String(properties.label ?? properties.name ?? properties.rank ?? "Feature"),
            });
          }
        }
      }) as any, ScreenSpaceEventType.LEFT_CLICK);
      viewer.current = instance;
    } catch { setError("Globe services are unavailable. Check the Cesium asset bundle or network connection."); }
    return () => { viewer.current?.destroy(); viewer.current = undefined; sources.current = []; };
  }, [selectMapFeature, setCameraTarget]);

  useEffect(() => {
    if (!viewer.current || !cameraTarget) return;
    void viewer.current.camera.flyTo({
      destination: Cartesian3.fromDegrees(cameraTarget.lon, cameraTarget.lat, cameraTarget.height ?? 50_000),
      duration: 1.15,
    });
  }, [cameraTarget]);

  useEffect(() => {
    if (!viewer.current || !mapFocus) return;
    if (resolvedMapLayers.length > 0 || result) return;
    void viewer.current.camera.flyTo({ destination: Rectangle.fromDegrees(mapFocus.west, mapFocus.south, mapFocus.east, mapFocus.north), duration: 1.25 });
  }, [mapFocus, resolvedMapLayers.length, result]);

  useEffect(() => {
    if (!viewer.current || (!result && resolvedMapLayers.length === 0)) return;
    viewer.current.dataSources.removeAll();
    sources.current = [];
    setLayers([]);
    const executionLayers = !result ? [] : result.mapLayers?.length ? result.mapLayers : [{ id: "candidates", name: result.layerName, kind: "candidates" as const, geojson: result.geojson, featureCount: result.featureCount, outputPath: result.outputPath }];
    // Draw coverage under candidates so pins stay on top. Preserve imports + agent layers together.
    const mapLayers = [...resolvedMapLayers, ...executionLayers].sort((left, right) => {
      const order = (kind: MapLayerKind) => kind === "coverage" ? 0 : kind === "roads" || kind === "waterways" || kind === "bridges" || kind === "stations" ? 1 : kind === "candidates" ? 3 : 2;
      return order(left.kind) - order(right.kind);
    });
    void Promise.all(mapLayers.map(async (layer) => {
      const style = styles[layer.kind] ?? styles.generic;
      const source = await GeoJsonDataSource.load(JSON.parse(layer.geojson), {
        clampToGround: true,
        fill: style.fill,
        stroke: style.stroke,
        strokeWidth: layer.kind === "coverage" ? 2 : style.width,
        markerColor: style.marker,
        markerSize: style.size,
      });
      source.name = layer.name;
      source.entities.values.forEach((entity) => {
        (entity as typeof entity & { __hekaLayerName?: string }).__hekaLayerName = layer.name;
        const now = JulianDate.now();
        if (entity.polygon) {
          entity.polygon.material = new ColorMaterialProperty(style.fill);
          entity.polygon.outline = new ConstantProperty(true);
          entity.polygon.outlineColor = new ConstantProperty(style.stroke);
          entity.polygon.outlineWidth = new ConstantProperty(layer.kind === "coverage" ? 2.5 : 1.5);
        }
        if (entity.polyline) {
          entity.polyline.material = new ColorMaterialProperty(style.stroke);
          entity.polyline.width = new ConstantProperty(style.width);
        }
        if (entity.point) {
          const rank = Number(entity.properties?.rank?.getValue(now) ?? 0);
          const pinSize = Number(entity.properties?.pinSize?.getValue(now) ?? style.size);
          const isTop = Boolean(entity.properties?.isTopPick?.getValue(now)) || rank === 1;
          entity.point.color = new ConstantProperty(isTop ? Color.fromCssColorString("#ef4444") : style.marker);
          entity.point.pixelSize = new ConstantProperty(layer.kind === "candidates" ? Math.max(pinSize, isTop ? 36 : 22) : style.size);
          entity.point.outlineColor = new ConstantProperty(Color.WHITE);
          entity.point.outlineWidth = new ConstantProperty(isTop ? 4 : 2);
          entity.point.disableDepthTestDistance = new ConstantProperty(Number.POSITIVE_INFINITY);
        }
        if (layer.kind === "candidates") {
          const rank = entity.properties?.rank?.getValue(now) ?? entity.properties?.label?.getValue(now);
          const isTop = Boolean(entity.properties?.isTopPick?.getValue(now)) || Number(rank) === 1;
          const text = rank != null ? (String(rank).startsWith("#") ? String(rank) : `#${rank}`) : "#";
          entity.label = {
            text: isTop ? `${text} TOP` : text,
            font: isTop ? "800 18px Inter, Segoe UI, sans-serif" : "700 14px Inter, Segoe UI, sans-serif",
            fillColor: Color.WHITE,
            outlineColor: isTop ? Color.fromCssColorString("#7f1d1d") : Color.fromCssColorString("#92400e"),
            outlineWidth: isTop ? 5 : 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.BOTTOM,
            horizontalOrigin: HorizontalOrigin.CENTER,
            pixelOffset: new Cartesian2(0, isTop ? -28 : -18),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new NearFarScalar(200, 1.45, 18000, 0.75),
          } as any;
        }
      });
      viewer.current?.dataSources.add(source);
      return { layer, source, visible: true };
    })).then((records) => {
      sources.current = records; setLayers(records);
      const candidates = records.find((record) => record.layer.kind === "candidates");
      if (candidates) {
        const top = candidates.source.entities.values.find((entity) => {
          const rank = entity.properties?.rank?.getValue?.(JulianDate.now());
          const isTop = entity.properties?.isTopPick?.getValue?.(JulianDate.now());
          return isTop === true || rank === 1;
        }) ?? candidates.source.entities.values[0];
        if (top) {
          void viewer.current?.flyTo(top, {
            duration: 1.15,
            offset: new HeadingPitchRange(0, -0.85, 9_500),
          });
          return;
        }
      }
      // If a tight camera target was already set for #1, don't yank out to full city layers.
      if (cameraTarget) return;
      const preferred = records.find((record) => record.layer.kind === "coverage") ?? records[0];
      if (preferred) void viewer.current?.flyTo(preferred.source, { duration: 1.25 });
      else if (mapFocus) void viewer.current?.camera.flyTo({ destination: Rectangle.fromDegrees(mapFocus.west, mapFocus.south, mapFocus.east, mapFocus.north), duration: 1.2 });
    }).catch(() => setError("Heka could not display the GeoJSON layers on the globe."));
  }, [result, resolvedMapLayers, mapFocus, cameraTarget]);

  const toggleLayer = (id: string) => setLayers((current) => current.map((record) => {
    if (record.layer.id !== id) return record;
    record.source.show = !record.visible;
    return { ...record, visible: !record.visible };
  }));

  const focusLayer = (id?: string) => {
    const visible = layers.filter((record) => record.visible);
    const candidates = visible.find((record) => record.layer.kind === "candidates");
    if (!id && candidates) {
      const top = candidates.source.entities.values.find((entity) => {
        const rank = entity.properties?.rank?.getValue?.(JulianDate.now());
        return rank === 1 || entity.properties?.isTopPick?.getValue?.(JulianDate.now()) === true;
      }) ?? candidates.source.entities.values[0];
      if (top) {
        void viewer.current?.flyTo(top, { duration: 1.0, offset: new HeadingPitchRange(0, -0.85, 9_500) });
        return;
      }
    }
    const primary = (id ? visible.find((record) => record.layer.id === id) : undefined)
      ?? candidates
      ?? visible.find((record) => record.layer.kind === "coverage")
      ?? visible[0];
    if (primary) void viewer.current?.flyTo(primary.source, { duration: 1.1 });
    else if (mapFocus) void viewer.current?.camera.flyTo({ destination: Rectangle.fromDegrees(mapFocus.west, mapFocus.south, mapFocus.east, mapFocus.north), duration: 1.1 });
  };

  return <section className="globe-panel"><div className="panel-label"><span>GLOBE VIEW</span><small>{mapFocus ? mapFocus.displayName : "WGS 84 / EPSG:4326"}</small></div><div className="cesium-host" ref={host} />
    {(layers.length > 0 || mapFocus) && <aside className="map-layers">
      <button className="layers-focus" onClick={() => focusLayer()} title="Zoom to ranked candidates"><Layers size={12} /> Map layers <Crosshair size={11} /></button>
      {layers.map(({ layer, visible }) => <div className="layer-row" key={layer.id}>
        <button onClick={() => toggleLayer(layer.id)} title={`Toggle · ${layer.featureCount} features`}><span className={`layer-swatch ${layer.kind}`} />{visible ? <Eye size={12} /> : <EyeOff size={12} />}<b>{layer.name}</b><em>{layer.featureCount}</em></button>
        <button className="layer-focus" onClick={() => focusLayer(layer.id)} title="Zoom to this layer"><Crosshair size={11} /></button>
      </div>)}
    </aside>}
    {error && <div className="globe-error">{error}</div>}</section>;
}
