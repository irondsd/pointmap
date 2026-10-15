import { useState } from "react";
import {
  category,
  colorLabel,
  formatCoords,
  formatKm,
  formatWhen,
  googleMapsUrl,
  lengthKm,
  organicMapsUrl,
  osmUrl,
  otherNames,
  type Place,
  type Track,
} from "./places";

// ---------------------------------------------------------------- descriptions
// Organic Maps and other apps put HTML in descriptions. Only plain formatting survives.

const ALLOWED = new Set(["B", "STRONG", "I", "EM", "U", "BR", "P", "UL", "OL", "LI", "A", "DIV", "SPAN"]);

function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const clean = (node: Element) => {
    for (const el of Array.from(node.children)) {
      if (!ALLOWED.has(el.tagName)) {
        el.replaceWith(
          doc.createTextNode(el.tagName === "SCRIPT" || el.tagName === "STYLE" ? "" : (el.textContent ?? "")),
        );
        continue;
      }
      const href = el.getAttribute("href");
      for (const a of Array.from(el.attributes)) el.removeAttribute(a.name);
      if (el.tagName === "A" && href && /^(https?:|mailto:|tel:)/i.test(href)) {
        el.setAttribute("href", href);
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
      clean(el);
    }
  };
  clean(doc.body);
  return doc.body.innerHTML;
}

function Description({ text }: { text: string }) {
  if (!/<[a-z][\s\S]*>/i.test(text)) return <div className="card-desc card-desc-plain">{text}</div>;
  return <div className="card-desc" dangerouslySetInnerHTML={{ __html: sanitize(text) }} />;
}

// ---------------------------------------------------------------- pieces

function Copy({ value, children }: { value: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="link-btn mono"
      title="Copy"
      onClick={() =>
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        })
      }
    >
      {copied ? "Copied" : children}
    </button>
  );
}

function Head(props: { color: string; title: string; subtitle?: string | null }) {
  return (
    <header className="card-head">
      <span className="card-dot" style={{ "--dot": props.color } as React.CSSProperties} aria-hidden />
      <div className="card-titles">
        <h3>{props.title}</h3>
        {props.subtitle && <div className="card-sub">{props.subtitle}</div>}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- cards

export function PlaceCard({ place }: { place: Place }) {
  const cat = category(place.types, place.icon);
  const aka = otherNames(place, navigator.languages ?? [navigator.language]);
  const coords = formatCoords(place.lat, place.lon);
  const zoom = place.zoom ?? 16;
  return (
    <article className="card">
      <Head color={place.color} title={place.name || "Unnamed point"} subtitle={cat.label} />
      {aka.length > 0 && <div className="card-aka">{aka.join(" · ")}</div>}
      {place.description && <Description text={place.description} />}
      {cat.extras.length > 0 && (
        <div className="tags">
          {cat.extras.map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </div>
      )}
      <dl className="card-facts">
        {place.data.map(([k, v]) => (
          <div key={k} className="fact">
            <dt>{k}</dt>
            <dd className="break">{v}</dd>
          </div>
        ))}
        {cat.access && (
          <div className="fact">
            <dt>Access</dt>
            <dd>{cat.access}</dd>
          </div>
        )}
        {place.when && (
          <div className="fact">
            <dt>Saved</dt>
            <dd>{formatWhen(place.when)}</dd>
          </div>
        )}
        <div className="fact">
          <dt>Color</dt>
          <dd>{colorLabel(place.colorName, place.color)}</dd>
        </div>
        <div className="fact">
          <dt>Location</dt>
          <dd>
            <Copy value={coords}>{coords}</Copy>
          </dd>
        </div>
      </dl>
      <nav className="card-links">
        <a href={organicMapsUrl(place.lat, place.lon, zoom, place.name)} target="_blank" rel="noopener noreferrer">
          Organic Maps
        </a>
        <a href={osmUrl(place.lat, place.lon, zoom)} target="_blank" rel="noopener noreferrer">
          OpenStreetMap
        </a>
        <a href={googleMapsUrl(place.lat, place.lon)} target="_blank" rel="noopener noreferrer">
          Google Maps
        </a>
      </nav>
    </article>
  );
}

export function TrackCard({ track }: { track: Track }) {
  const points = track.lines.reduce((n, l) => n + l.length, 0);
  return (
    <article className="card">
      <Head color={track.color} title={track.name} subtitle="Track" />
      {track.description && <Description text={track.description} />}
      <dl className="card-facts">
        <div className="fact">
          <dt>Length</dt>
          <dd>{formatKm(lengthKm(track.lines))}</dd>
        </div>
        <div className="fact">
          <dt>Points</dt>
          <dd>{points}</dd>
        </div>
        {track.when && (
          <div className="fact">
            <dt>Saved</dt>
            <dd>{formatWhen(track.when)}</dd>
          </div>
        )}
      </dl>
    </article>
  );
}
