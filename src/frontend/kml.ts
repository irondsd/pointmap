import { DEFAULT_COLOR, kmlColor, PALETTE, type Place, type PlaceList, type Track } from "./places";
import { isZip, listEntries, readEntry } from "./zip";

/** Turns the bytes of a .kmz or .kml file into a place list. */
export async function parseListFile(bytes: Uint8Array): Promise<PlaceList> {
  return parseKml(await kmlText(bytes));
}

export async function kmlText(bytes: Uint8Array): Promise<string> {
  if (!isZip(bytes)) return new TextDecoder().decode(bytes);
  const entries = listEntries(bytes).filter((e) => e.name.toLowerCase().endsWith(".kml"));
  // Google Earth names it doc.kml; Organic Maps names it after the list.
  const main = entries.find((e) => e.name.toLowerCase() === "doc.kml") ?? entries[0];
  if (!main) throw new Error("The .kmz has no .kml file inside");
  return new TextDecoder().decode(await readEntry(bytes, main));
}

// ---------------------------------------------------------------- DOM helpers
// KML mixes namespaces (kml, gx, Organic Maps' mwm), so elements are matched on their local name.

const kids = (el: Element | null | undefined, name: string): Element[] =>
  el ? Array.from(el.children).filter((c) => c.localName === name) : [];
const kid = (el: Element | null | undefined, name: string): Element | undefined => kids(el, name)[0];
const text = (el: Element | null | undefined): string | null => {
  const t = el?.textContent?.trim();
  return t ? t : null;
};
const all = (root: Document | Element, name: string): Element[] => Array.from(root.getElementsByTagNameNS("*", name));

/** <mwm:name><mwm:lang code="en">…</mwm:lang></mwm:name> → { en: "…" } */
function langs(el: Element | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of kids(el, "lang")) {
    const code = l.getAttribute("code");
    const t = text(l);
    if (code && t) out[code] = t;
  }
  return out;
}

function parseCoords(s: string | null): [number, number][] {
  if (!s) return [];
  const out: [number, number][] = [];
  for (const tuple of s.split(/\s+/)) {
    const [lon, lat] = tuple.split(",").map(Number);
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push([lon!, lat!]);
  }
  return out;
}

// ---------------------------------------------------------------- styles

interface StyleInfo {
  icon: string | null;
  iconName: string | null;
  line: string | null;
}

function readStyle(style: Element): StyleInfo {
  const id = style.getAttribute("id") ?? "";
  const named = id.match(/^placemark-(\w+)$/)?.[1];
  const iconName = named && PALETTE[named] ? named : null;
  return {
    icon: iconName ? PALETTE[iconName]! : kmlColor(text(kid(kid(style, "IconStyle"), "color"))),
    iconName,
    line: kmlColor(text(kid(kid(style, "LineStyle"), "color"))),
  };
}

function readStyles(doc: Document): (url: string | null) => StyleInfo | undefined {
  const styles = new Map<string, StyleInfo>();
  for (const s of all(doc, "Style")) {
    const id = s.getAttribute("id");
    if (id) styles.set(id, readStyle(s));
  }
  // StyleMaps pair a normal and a highlight style; the normal one is what's drawn.
  const maps = new Map<string, string>();
  for (const m of all(doc, "StyleMap")) {
    const id = m.getAttribute("id");
    const normal = kids(m, "Pair").find((p) => text(kid(p, "key")) === "normal");
    const url = text(kid(normal, "styleUrl"));
    if (id && url) maps.set(id, url.replace(/^#/, ""));
  }
  return (url) => {
    if (!url) return undefined;
    const id = url.replace(/^.*#/, "");
    return styles.get(maps.get(id) ?? id);
  };
}

// ---------------------------------------------------------------- parse

export function parseKml(xml: string): PlaceList {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("The file is not valid KML");
  const style = readStyles(doc);

  const document = all(doc, "Document")[0];
  const docExt = kid(document, "ExtendedData");
  const list: PlaceList = {
    name: langs(kid(docExt, "name")).default ?? text(kid(document, "name")) ?? "Untitled",
    author: text(kid(docExt, "author")),
    description: text(kid(document, "description")) ?? langs(kid(docExt, "description")).default ?? null,
    modified: text(kid(docExt, "lastModified")),
    places: [],
    tracks: [],
  };

  let id = 0;
  for (const pm of all(doc, "Placemark")) {
    const ext = kid(pm, "ExtendedData");
    const names = langs(kid(ext, "name"));
    const inline = kid(pm, "Style");
    const st = inline ? readStyle(inline) : style(text(kid(pm, "styleUrl")));
    const name = text(kid(pm, "name")) ?? names.default ?? "";
    const description = text(kid(pm, "description")) ?? langs(kid(ext, "description")).default ?? null;
    const when = text(kid(kid(pm, "TimeStamp"), "when"));

    const points: [number, number][] = [];
    const lines: [number, number][][] = [];
    // Geometry can be nested in MultiGeometry, so look anywhere under the placemark.
    for (const p of all(pm, "Point")) points.push(...parseCoords(text(kid(p, "coordinates"))).slice(0, 1));
    for (const l of all(pm, "LineString")) lines.push(parseCoords(text(kid(l, "coordinates"))));
    for (const t of all(pm, "Track")) {
      lines.push(
        kids(t, "coord").flatMap((c) => {
          const [lon, lat] = (c.textContent ?? "").trim().split(/\s+/).map(Number);
          return Number.isFinite(lon) && Number.isFinite(lat) ? [[lon!, lat!] as [number, number]] : [];
        }),
      );
    }

    if (lines.some((l) => l.length > 1)) {
      const track: Track = {
        id: id++,
        name: name || "Track",
        color: st?.line ?? st?.icon ?? DEFAULT_COLOR,
        description,
        when,
        lines: lines.filter((l) => l.length > 1),
      };
      list.tracks.push(track);
      continue;
    }

    const at = points[0];
    if (!at) continue;
    const zoom = Number(text(kid(ext, "scale")));
    const place: Place = {
      id: id++,
      name: name || names.default || "",
      lon: at[0],
      lat: at[1],
      color: st?.icon ?? DEFAULT_COLOR,
      colorName: st?.iconName ?? null,
      description,
      when,
      types: kids(kid(ext, "featureTypes"), "value").flatMap((v) => text(v) ?? []),
      icon: text(kid(ext, "icon")),
      names,
      zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : null,
      data: kids(ext, "Data").flatMap((d) => {
        const k = text(kid(d, "displayName")) ?? d.getAttribute("name");
        const v = text(kid(d, "value"));
        return k && v ? [[k, v] as [string, string]] : [];
      }),
    };
    list.places.push(place);
  }
  return list;
}
