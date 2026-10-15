/** A single saved point. Everything but the coordinates is optional in a KML file. */
export interface Place {
  id: number;
  name: string;
  lat: number;
  lon: number;
  /** #rrggbb */
  color: string;
  /** Organic Maps palette name ("red", "deeppurple"), when the point uses one. */
  colorName: string | null;
  /** May contain HTML. */
  description: string | null;
  /** When the point was saved (ISO 8601). */
  when: string | null;
  /** Organic Maps feature types of the place the point was dropped on, e.g. "tourism-viewpoint". */
  types: string[];
  /** Organic Maps bookmark icon, e.g. "Sights". */
  icon: string | null;
  /** Names by language code ("default", "en", "int_name", …). */
  names: Record<string, string>;
  /** Zoom level the point was saved at. */
  zoom: number | null;
  /** Plain KML <ExtendedData><Data> fields, as written by other apps. */
  data: [string, string][];
}

export interface Track {
  id: number;
  name: string;
  color: string;
  description: string | null;
  when: string | null;
  /** [lon, lat] pairs; one array per line. */
  lines: [number, number][][];
}

export interface PlaceList {
  name: string;
  author: string | null;
  description: string | null;
  modified: string | null;
  places: Place[];
  tracks: Track[];
}

// ---------------------------------------------------------------- colors

/** Organic Maps' bookmark palette, keyed by the suffix of its `placemark-<color>` style ids. */
export const PALETTE: Record<string, string> = {
  red: "#e51b23",
  pink: "#ff4182",
  purple: "#9b24b2",
  deeppurple: "#6639bf",
  blue: "#0066cc",
  lightblue: "#249cf2",
  cyan: "#14becd",
  teal: "#00a58c",
  green: "#3c8c3c",
  lime: "#93bf39",
  yellow: "#ffc800",
  orange: "#ff9600",
  deeporange: "#f06432",
  brown: "#804633",
  gray: "#737373",
  bluegray: "#597380",
};

export const DEFAULT_COLOR = PALETTE.red!;

const COLOR_LABELS: Record<string, string> = {
  deeppurple: "Deep purple",
  lightblue: "Light blue",
  deeporange: "Deep orange",
  bluegray: "Blue gray",
};

export function colorLabel(name: string | null, hex: string): string {
  if (!name) return hex;
  return COLOR_LABELS[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

/** KML colors are aabbggrr. Returns #rrggbb, or null when unparseable. */
export function kmlColor(s: string | null | undefined): string | null {
  const m = s?.trim().match(/^#?([0-9a-f]{8}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  const [b, g, r] =
    h.length === 8 ? [h.slice(2, 4), h.slice(4, 6), h.slice(6, 8)] : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  return `#${r}${g}${b}`;
}

/** Black or white, whichever reads better on the given color. */
export function contrastText(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? "#1d1b17" : "#ffffff";
}

// ---------------------------------------------------------------- categories

/** Routing and bookkeeping tags that mean nothing to a person looking at the point. */
const HIDDEN = /^(psurface|hwtag|sponsored|wheelchair)-|^(oneway|building-address)$/;

const LABELS: Record<string, string> = {
  building: "Building",
  "building-address": "Address",
  "railway-station": "Railway station",
  "railway-halt": "Railway halt",
  "railway-subway_entrance": "Subway entrance",
  "railway-tram_stop": "Tram stop",
  "highway-bus_stop": "Bus stop",
  "amenity-bus_station": "Bus station",
  "amenity-ferry_terminal": "Ferry terminal",
  "public_transport-platform": "Platform",
  "aeroway-aerodrome": "Airport",
  "aeroway-aerodrome-international": "International airport",
  "place-city": "City",
  "place-town": "Town",
  "place-village": "Village",
  "place-hamlet": "Hamlet",
  "internet_access-wlan": "Wi-Fi",
};

const ACCESS: Record<string, string> = {
  "wheelchair-yes": "Wheelchair accessible",
  "wheelchair-limited": "Limited wheelchair access",
  "wheelchair-no": "Not wheelchair accessible",
};

const humanize = (s: string) => s.replace(/_/g, " ");
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "tourism-viewpoint" → "Viewpoint", "amenity-place_of_worship-christian" → "Place of worship · Christian". */
export function typeLabel(type: string): string {
  const known = LABELS[type];
  if (known) return known;
  if (type.startsWith("place-city-capital")) return "Capital city";
  const segs = type.split("-").filter((s) => !/^\d+$/.test(s));
  if (segs.length === 1) return capitalize(humanize(segs[0]!));
  const [cls, ...rest] = segs;
  if (cls === "highway" && !["footway", "path", "pedestrian", "cycleway", "steps", "track"].includes(rest[0]!))
    return "Road";
  if (cls === "cuisine") return `${capitalize(humanize(rest.join(" ")))} cuisine`;
  return rest.map((s) => capitalize(humanize(s))).join(" · ");
}

export interface Category {
  /** What the place is, e.g. "Viewpoint". */
  label: string | null;
  /** Other things it also is. */
  extras: string[];
  access: string | null;
}

export function category(types: string[], icon: string | null): Category {
  const shown = types.filter((t) => !HIDDEN.test(t));
  const labels = [...new Set(shown.map(typeLabel))];
  const access = types.map((t) => ACCESS[t]).find(Boolean) ?? null;
  // "building-address" alone still says something.
  if (!labels.length && types.includes("building-address")) labels.push("Address");
  return {
    label: labels[0] ?? (icon && icon !== "None" ? humanize(icon) : null),
    extras: labels.slice(1),
    access,
  };
}

// ---------------------------------------------------------------- names

/** Names in other languages worth showing, the reader's own language first. */
export function otherNames(place: Place, langs: readonly string[]): string[] {
  const seen = new Set([place.name.trim().toLowerCase()]);
  const out: string[] = [];
  const codes = [...langs.map((l) => l.split("-")[0]!), "en", "int_name", "alt_name", "old_name"];
  for (const code of codes) {
    const n = place.names[code]?.trim();
    if (n && !seen.has(n.toLowerCase())) {
      seen.add(n.toLowerCase());
      out.push(n);
    }
  }
  return out.slice(0, 3);
}

// ---------------------------------------------------------------- formatting

export const nf = new Intl.NumberFormat();

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatCoords(lat: number, lon: number): string {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

const R = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

export function lengthKm(lines: [number, number][][]): number {
  let km = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [lon1, lat1] = line[i - 1]!;
      const [lon2, lat2] = line[i]!;
      const a =
        Math.sin(rad(lat2 - lat1) / 2) ** 2 +
        Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
      km += 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
    }
  }
  return km;
}

export function formatKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km < 10 ? km.toFixed(1) : nf.format(Math.round(km))} km`;
}

/** [west, south, east, north] around everything in the list, or null when it's empty. */
export function boundsOf(list: PlaceList): [number, number, number, number] | null {
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  const add = (lon: number, lat: number) => {
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  };
  for (const p of list.places) add(p.lon, p.lat);
  for (const t of list.tracks) for (const l of t.lines) for (const [lon, lat] of l) add(lon, lat);
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

// ---------------------------------------------------------------- links

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const COORD_BITS = 30;
const MAX_COORD = 2 ** COORD_BITS - 1;

/** Organic Maps' short "ge0" link: one char of zoom, nine of interleaved lat/lon bits, then the name. Opens the app on phones. */
export function organicMapsUrl(lat: number, lon: number, zoom: number, name: string): string {
  const z = zoom <= 4 ? 0 : zoom >= 19.75 ? 63 : Math.floor((zoom - 4) * 4);
  const latI = Math.round(((Math.max(-90, Math.min(90, lat)) + 90) / 180) * MAX_COORD);
  const x = (((lon + 180) % 360) + 360) % 360;
  const lonI = Math.round((x / 360) * MAX_COORD) % (MAX_COORD + 1);
  let code = B64[z]!;
  for (let shift = COORD_BITS - 3; shift >= 3; shift -= 3) {
    const la = (latI >> shift) & 7;
    const lo = (lonI >> shift) & 7;
    code +=
      B64[
        (((la >> 2) & 1) << 5) |
          (((lo >> 2) & 1) << 4) |
          (((la >> 1) & 1) << 3) |
          (((lo >> 1) & 1) << 2) |
          ((la & 1) << 1) |
          (lo & 1)
      ];
  }
  // Spaces and underscores swap places so names read naturally in the link.
  const n = name.replace(/[ _]/g, (c) => (c === " " ? "_" : " "));
  return `https://omaps.app/${code}${n ? `/${encodeURIComponent(n)}` : ""}`;
}

export function decodeOrganicMaps(code: string): { lat: number; lon: number; zoom: number } {
  const zoom = B64.indexOf(code[0]!) / 4 + 4;
  let latI = 0,
    lonI = 0;
  for (const ch of code.slice(1, 10)) {
    const v = B64.indexOf(ch);
    latI = (latI << 3) | (((v >> 5) & 1) << 2) | (((v >> 3) & 1) << 1) | ((v >> 1) & 1);
    lonI = (lonI << 3) | (((v >> 4) & 1) << 2) | (((v >> 2) & 1) << 1) | (v & 1);
  }
  // Nine chars carry the top 27 of the 30 bits.
  latI *= 8;
  lonI *= 8;
  return { lat: (latI / MAX_COORD) * 180 - 90, lon: (lonI / MAX_COORD) * 360 - 180, zoom };
}

export const osmUrl = (lat: number, lon: number, zoom = 17) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${Math.round(zoom)}/${lat}/${lon}`;
export const googleMapsUrl = (lat: number, lon: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
