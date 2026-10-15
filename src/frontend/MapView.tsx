import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Map as MlMap,
  NavigationControl,
  Popup,
  ScaleControl,
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type MapMouseEvent,
  type Offset,
  type SymbolLayerSpecification,
} from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { collapseAttribution, drawPin, FONT, PIN_HEIGHT, PIN_PAD, PIN_PREFIX, PIN_RATIO, pinId, STYLE } from "./map";
import { boundsOf, type PlaceList } from "./places";
import type { View } from "./store";

export type Selection = { kind: "place"; id: number } | { kind: "track"; id: number; at: [number, number] };

export interface MapViewProps {
  list: PlaceList | null;
  /** Changes when a different list is opened, so the map knows to reposition. */
  listKey: string | null;
  initialView: View | null;
  dark: boolean;
  selected: Selection | null;
  /** Bumped to fly to the selected place. */
  flyTo: number;
  /** Pin size multiplier; ⌘/Ctrl+Shift+scroll over the map asks to change it. */
  pinScale: number;
  onPinScale(scale: number): void;
  onSelect(s: Selection | null): void;
  onView(v: View): void;
  /** Rendered inside the popup for the selection. */
  children: React.ReactNode;
}

const SRC_PLACES = "places";
const SRC_TRACKS = "tracks";
const L = {
  trackCasing: "track-casing",
  track: "track",
  places: "places",
  selected: "place-selected",
};

export const PIN_SCALE = { min: 0.5, max: 3, default: 1 };
/** How much bigger the selected pin is drawn. */
const SELECTED = 1.35;

/** Keeps a place's popup clear of its (selected) pin. */
function placePopupOffset(scale: number): Offset {
  const top = -(PIN_HEIGHT * scale * SELECTED + 4);
  const mid = top / 2;
  return {
    center: [0, 0],
    top: [0, 4],
    "top-left": [0, 4],
    "top-right": [0, 4],
    bottom: [0, top],
    "bottom-left": [0, top],
    "bottom-right": [0, top],
    left: [12 * scale, mid],
    right: [-12 * scale, mid],
  };
}

type FC = FeatureCollection;
const EMPTY: FC = { type: "FeatureCollection", features: [] };

function placesData(list: PlaceList | null): FC {
  if (!list) return EMPTY;
  return {
    type: "FeatureCollection",
    features: list.places.map((p) => ({
      type: "Feature",
      id: p.id,
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: { id: p.id, name: p.name, pin: pinId(p.color) },
    })),
  };
}

function tracksData(list: PlaceList | null): FC {
  if (!list) return EMPTY;
  return {
    type: "FeatureCollection",
    features: list.tracks.map((t) => ({
      type: "Feature",
      id: t.id,
      geometry: { type: "MultiLineString", coordinates: t.lines },
      properties: { id: t.id, color: t.color },
    })),
  };
}

function fit(map: MlMap, list: PlaceList, animate: boolean) {
  const b = boundsOf(list);
  if (!b) return;
  map.fitBounds(
    [
      [b[0], b[1]],
      [b[2], b[3]],
    ],
    { padding: 60, maxZoom: 14, animate },
  );
}

export function MapView(props: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const data = useRef({ places: EMPTY, tracks: EMPTY });
  const cb = useRef(props);
  cb.current = props;
  // Wheel events can outpace re-renders; the handler keeps the latest size here.
  const scaleRef = useRef(props.pinScale);
  scaleRef.current = props.pinScale;
  const popup = useRef<Popup | null>(null);
  const [popupNode] = useState(() => document.createElement("div"));
  const shownKey = useRef<string | null>(null);

  // Create the map once.
  useEffect(() => {
    const v = props.initialView;
    const map = new MlMap({
      container: container.current!,
      style: props.dark ? STYLE.dark : STYLE.light,
      center: v?.center ?? [10, 30],
      zoom: v?.zoom ?? 1.5,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ maxWidth: 100 }), "bottom-right");
    collapseAttribution(map);
    mapRef.current = map;
    // The positioning effect below must not refit a list the saved view already shows.
    if (v) shownKey.current = props.listKey;

    // Pins are drawn per color as the style asks for them; this also restores them after a theme switch.
    map.setMissingStyleImageResolver((id) => {
      if (id.startsWith(PIN_PREFIX) && !map.hasImage(id))
        map.addImage(id, drawPin(`#${id.slice(PIN_PREFIX.length)}`), { pixelRatio: PIN_RATIO });
    });

    // setStyle drops our sources and layers; put them back each time a style finishes loading.
    map.on("style.load", () => addLayers(map, cb.current.dark));

    const pick = (e: MapMouseEvent): MapGeoJSONFeature | undefined => {
      const pad = 6;
      const box: [[number, number], [number, number]] = [
        [e.point.x - pad, e.point.y - pad],
        [e.point.x + pad, e.point.y + pad],
      ];
      const layers = [L.selected, L.places, L.track].filter((l) => map.getLayer(l));
      const hits = map.queryRenderedFeatures(box, { layers });
      const rank = (f: MapGeoJSONFeature) => layers.indexOf(f.layer.id);
      return hits.sort((a, b) => rank(a) - rank(b))[0];
    };

    map.on("click", (e) => {
      // Pins overlap; the topmost one under the cursor wins.
      const f = pick(e);
      if (!f) return cb.current.onSelect(null);
      const id = f.properties.id as number;
      if (f.layer.id === L.track) cb.current.onSelect({ kind: "track", id, at: [e.lngLat.lng, e.lngLat.lat] });
      else cb.current.onSelect({ kind: "place", id });
    });
    map.on("mousemove", (e) => {
      map.getCanvas().style.cursor = pick(e) ? "pointer" : "";
    });
    map.on("moveend", () => {
      const c = map.getCenter();
      cb.current.onView({ center: [c.lng, c.lat], zoom: map.getZoom() });
    });

    // ⌘/Ctrl+Shift+scroll resizes pins instead of zooming. Captured here, before maplibre's own wheel handler.
    const onWheel = (e: WheelEvent) => {
      if (!e.shiftKey || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      e.stopPropagation();
      // Shift turns a mouse wheel's vertical scroll into horizontal on macOS.
      let d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) d *= 33;
      const scale = Math.min(PIN_SCALE.max, Math.max(PIN_SCALE.min, scaleRef.current * Math.exp(-d / 300)));
      scaleRef.current = scale;
      cb.current.onPinScale(scale);
    };
    const el = container.current!;
    el.addEventListener("wheel", onWheel, { capture: true, passive: false });

    return () => {
      el.removeEventListener("wheel", onWheel, { capture: true });
      popup.current?.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the map is created once; changes go through the effects below.
  }, []);

  // Theme switch.
  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    mapRef.current?.setStyle(props.dark ? STYLE.dark : STYLE.light, { diff: false });
  }, [props.dark]);

  // Data.
  useEffect(() => {
    data.current = {
      places: placesData(props.list),
      tracks: tracksData(props.list),
    };
    const map = mapRef.current;
    map?.getSource<GeoJSONSource>(SRC_PLACES)?.setData(data.current.places);
    map?.getSource<GeoJSONSource>(SRC_TRACKS)?.setData(data.current.tracks);
  }, [props.list]);

  // Position: a newly opened list gets its saved view, or is fitted into view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.list || shownKey.current === props.listKey) return;
    shownKey.current = props.listKey;
    if (props.initialView) map.jumpTo(props.initialView);
    else fit(map, props.list, false);
  }, [props.list, props.listKey, props.initialView]);

  // Selection: highlight and popup.
  const sel = props.selected;
  const place = sel?.kind === "place" ? props.list?.places.find((p) => p.id === sel.id) : undefined;
  const track = sel?.kind === "track" ? props.list?.tracks.find((t) => t.id === sel.id) : undefined;
  const anchor: [number, number] | null = place
    ? [place.lon, place.lat]
    : sel?.kind === "track" && track
      ? sel.at
      : null;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => map.getLayer(L.selected) && map.setFilter(L.selected, ["==", ["get", "id"], place?.id ?? -1]);
    apply();
    map.on("style.load", apply);
    return () => {
      map.off("style.load", apply);
    };
  }, [place?.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!anchor) {
      const p = popup.current;
      popup.current = null;
      p?.remove();
      return;
    }
    if (!popup.current) {
      const p = new Popup({
        closeOnClick: false,
        maxWidth: "340px",
        focusAfterOpen: false,
      }).setDOMContent(popupNode);
      p.on("close", () => {
        // Only a close by the user (✕ button) clears the selection; programmatic removals have already done so.
        if (popup.current === p) {
          popup.current = null;
          cb.current.onSelect(null);
        }
      });
      popup.current = p;
    }
    popup.current.setLngLat(anchor).setOffset(place ? placePopupOffset(props.pinScale) : 12);
    // addTo() on an open popup removes it first, which would read as the user closing it.
    if (!popup.current.isOpen()) popup.current.addTo(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- anchor is derived; its parts are the deps.
  }, [anchor?.[0], anchor?.[1], place?.id, track?.id, props.pinScale]);

  // Pin size.
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer(L.places)) return;
    map.setLayoutProperty(L.places, "icon-size", props.pinScale);
    map.setLayoutProperty(L.selected, "icon-size", props.pinScale * SELECTED);
  }, [props.pinScale]);

  // Fly to the selected place when asked (from search).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.flyTo || !place) return;
    // Near the zoom it was saved at, but never zooming out.
    const zoom = Math.max(map.getZoom(), Math.min(place.zoom ?? 15, 17));
    map.flyTo({ center: [place.lon, place.lat], zoom, duration: 900 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on request.
  }, [props.flyTo]);

  return (
    <>
      <div ref={container} className="map" />
      {anchor && createPortal(props.children, popupNode)}
    </>
  );

  function addLayers(map: MlMap, dark: boolean) {
    map.addSource(SRC_TRACKS, { type: "geojson", data: data.current.tracks });
    map.addSource(SRC_PLACES, { type: "geojson", data: data.current.places });

    map.addLayer({
      id: L.trackCasing,
      type: "line",
      source: SRC_TRACKS,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": dark ? "#121212" : "#ffffff", "line-width": 7, "line-opacity": 0.85 },
    });
    map.addLayer({
      id: L.track,
      type: "line",
      source: SRC_TRACKS,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 4 },
    });

    const pinLayout = (size: number): SymbolLayerSpecification["layout"] => ({
      "icon-image": ["get", "pin"],
      "icon-size": size,
      "icon-anchor": "bottom",
      "icon-offset": [0, PIN_PAD],
      // Every pin is drawn, overlapping like in Organic Maps; with overlap allowed maplibre stacks them by
      // screen position, so pins lower on the screen sit in front.
      "icon-allow-overlap": true,
      // Names appear once there's room for them; pins never give way to labels.
      "text-field": ["step", ["zoom"], "", 12, ["get", "name"]],
      "text-font": FONT.regular,
      "text-size": 12,
      "text-anchor": "top",
      "text-offset": [0, 0.35],
      "text-max-width": 9,
      "text-optional": true,
    });
    const labelPaint = {
      "text-color": dark ? "#ece9e3" : "#1d1b17",
      "text-halo-color": dark ? "#121212" : "#ffffff",
      "text-halo-width": 1.5,
    };
    map.addLayer({
      id: L.places,
      type: "symbol",
      source: SRC_PLACES,
      layout: pinLayout(cb.current.pinScale),
      paint: labelPaint,
    });
    map.addLayer({
      id: L.selected,
      type: "symbol",
      source: SRC_PLACES,
      filter: ["==", ["get", "id"], -1],
      layout: { ...pinLayout(cb.current.pinScale * SELECTED), "text-field": "" },
      paint: labelPaint,
    });
  }
}
