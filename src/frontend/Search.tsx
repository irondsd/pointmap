import { useEffect, useMemo, useRef, useState } from "react";
import { category, type Place, type PlaceList } from "./places";

const LIMIT = 40;

/** Lowercase without accents, so "zurich" finds "Zürich". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

interface Indexed {
  place: Place;
  label: string | null;
  haystack: string;
}

export function Search({ list, onPick }: { list: PlaceList; onPick(id: number): void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listEl = useRef<HTMLUListElement>(null);

  const index = useMemo<Indexed[]>(
    () =>
      list.places.map((place) => {
        const label = category(place.types, place.icon).label;
        return {
          place,
          label,
          haystack: fold([place.name, ...Object.values(place.names), label ?? "", place.description ?? ""].join("\n")),
        };
      }),
    [list],
  );

  const results = useMemo(() => {
    const terms = fold(q).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const hits = index.filter((x) => terms.every((t) => x.haystack.includes(t)));
    // Names that start with the query first.
    const first = terms[0]!;
    const starts = (x: Indexed) => (fold(x.place.name).startsWith(first) ? 0 : 1);
    return hits.sort((a, b) => starts(a) - starts(b)).slice(0, LIMIT);
  }, [q, index]);

  useEffect(() => setCursor(0), [q]);
  useEffect(() => {
    listEl.current?.children[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // "/" focuses the search, like on most sites.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const choose = (p: Place) => {
    onPick(p.id);
    setOpen(false);
    input.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(results.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      const r = results[cursor];
      if (r) choose(r.place);
    } else if (e.key === "Escape") {
      if (q) setQ("");
      else input.current?.blur();
    }
  };

  return (
    <div className="search">
      <svg className="search-icon" viewBox="0 0 16 16" aria-hidden>
        <circle cx="7" cy="7" r="4.5" />
        <path d="m10.5 10.5 3 3" />
      </svg>
      <input
        ref={input}
        className="input search-input"
        type="search"
        value={q}
        placeholder={`Search ${list.places.length} places`}
        aria-label="Search places"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open && q.trim() && (
        <ul className="search-results" ref={listEl} role="listbox">
          {results.length === 0 && <li className="search-empty dim">No places match</li>}
          {results.map((r, i) => (
            <li
              key={r.place.id}
              role="option"
              aria-selected={i === cursor}
              // mousedown, so the pick happens before the input's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(r.place);
              }}
              onMouseEnter={() => setCursor(i)}
            >
              <span className="search-dot" style={{ background: r.place.color }} />
              <span className="search-name">{r.place.name || "Unnamed point"}</span>
              {r.label && <span className="dim small search-label">{r.label}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
