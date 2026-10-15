import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AddPath, ChooseFiles, counts, Library } from "./Library";
import {
  addPath,
  addUpload,
  deleteBytes,
  loadActive,
  loadEntries,
  loadView,
  openEntry,
  saveActive,
  saveEntries,
  saveView,
  upsert,
  type Entry,
  type View,
} from "./store";
import { HAS_SERVER } from "./env";
import { MapView, PIN_SCALE, type Selection } from "./MapView";
import { PlaceCard, TrackCard } from "./PlaceCard";
import type { PlaceList } from "./places";
import { Search } from "./Search";

// ---------------------------------------------------------------- theme

type ThemePref = "system" | "light" | "dark";

function savedTheme(): ThemePref {
  try {
    const t = localStorage.getItem("pt.theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function usePrefersDark() {
  const [dark, setDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return dark;
}

/** The chosen theme and whether it resolves to dark. The resolved theme is put on <html data-theme>. */
function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(savedTheme);
  const systemDark = usePrefersDark();
  const dark = pref === "system" ? systemDark : pref === "dark";
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  const setPref = useCallback((t: ThemePref) => {
    setPrefState(t);
    try {
      if (t === "system") localStorage.removeItem("pt.theme");
      else localStorage.setItem("pt.theme", t);
    } catch {
      // Storage can be unavailable; the theme just won't be remembered.
    }
  }, []);
  return { pref, setPref, dark };
}

const THEMES: { value: ThemePref; label: string; icon: React.ReactNode }[] = [
  {
    value: "system",
    label: "System theme",
    icon: (
      <>
        <rect x="2" y="3" width="12" height="8.5" rx="1.5" />
        <path d="M5.5 14h5M8 11.5V14" />
      </>
    ),
  },
  {
    value: "light",
    label: "Light theme",
    icon: (
      <>
        <circle cx="8" cy="8" r="2.75" />
        <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06" />
      </>
    ),
  },
  {
    value: "dark",
    label: "Dark theme",
    icon: <path d="M13.5 9.8A5.75 5.75 0 0 1 6.2 2.5a5.75 5.75 0 1 0 7.3 7.3Z" />,
  },
];

function ThemeSwitch(props: { value: ThemePref; onChange: (t: ThemePref) => void }) {
  return (
    <div className="segmented segmented-icons" role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t.value}
          aria-pressed={props.value === t.value}
          aria-label={t.label}
          title={t.label}
          onClick={() => props.onChange(t.value)}
        >
          <svg viewBox="0 0 16 16" aria-hidden>
            {t.icon}
          </svg>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- pin size

function savedPinScale(): number {
  try {
    const n = Number(localStorage.getItem("pt.pinScale"));
    return n >= PIN_SCALE.min && n <= PIN_SCALE.max ? n : PIN_SCALE.default;
  } catch {
    return PIN_SCALE.default;
  }
}

/** The pin size, remembered, plus whether to show its hint (briefly, while it's being changed). */
function usePinScale() {
  const [scale, setScaleState] = useState(savedPinScale);
  const [hint, setHint] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const setScale = useCallback((s: number) => {
    setScaleState(s);
    setHint(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setHint(false);
      try {
        if (s === PIN_SCALE.default) localStorage.removeItem("pt.pinScale");
        else localStorage.setItem("pt.pinScale", String(s));
      } catch {
        // Storage can be unavailable; the size just won't be remembered.
      }
    }, 900);
  }, []);
  return { scale, setScale, hint };
}

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

// ---------------------------------------------------------------- app

export function App() {
  const { pref: theme, setPref: setTheme, dark } = useTheme();
  const pins = usePinScale();
  const [entries, setEntriesState] = useState<Entry[]>(loadEntries);
  const [activeId, setActiveId] = useState<string | null>(() => {
    const id = loadActive();
    return id && loadEntries().some((e) => e.id === id) ? id : null;
  });
  const [list, setList] = useState<PlaceList | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [flyTo, setFlyTo] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [initialView, setInitialView] = useState<View | null>(() => (activeId ? loadView(activeId) : null));

  const setEntries = useCallback((next: Entry[]) => {
    setEntriesState(next);
    saveEntries(next);
  }, []);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  /** Shows a list that's already been read. */
  const show = useCallback(
    (entry: Entry, l: PlaceList) => {
      entriesRef.current = upsert(entriesRef.current, entry);
      setEntries(entriesRef.current);
      setErrors(({ [entry.id]: _, ...rest }) => rest);
      if (activeRef.current !== entry.id) setInitialView(loadView(entry.id));
      // Ids are positions in the file, so a reloaded file may have moved them.
      setSelected(null);
      setActiveId(entry.id);
      saveActive(entry.id);
      setList(l);
    },
    [setEntries],
  );

  const open = useCallback(
    async (entry: Entry) => {
      setLoadingId(entry.id);
      try {
        const l = await openEntry(entry);
        show({ ...entry, name: l.name, places: l.places.length, tracks: l.tracks.length, openedAt: Date.now() }, l);
        return true;
      } catch (err) {
        setErrors((e) => ({ ...e, [entry.id]: (err as Error).message }));
        return false;
      } finally {
        setLoadingId(null);
      }
    },
    [show],
  );

  // Reopen the list that was showing last time.
  useEffect(() => {
    const entry = entries.find((e) => e.id === activeId);
    if (!entry) return;
    open(entry).then((ok) => {
      if (!ok) setLibraryOpen(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on start.
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      const bad: string[] = [];
      let last: { entry: Entry; list: PlaceList } | null = null;
      for (const f of files) {
        if (!/\.km[lz]$/i.test(f.name)) {
          bad.push(`${f.name}: not a .kmz or .kml file`);
          continue;
        }
        try {
          last = await addUpload(entriesRef.current, f);
          entriesRef.current = upsert(entriesRef.current, last.entry);
          setEntries(entriesRef.current);
        } catch (err) {
          bad.push(`${f.name}: ${(err as Error).message}`);
        }
      }
      if (last) {
        show(last.entry, last.list);
        setLibraryOpen(false);
      }
      setNotice(bad.length ? bad.join("\n") : null);
    },
    [setEntries, show],
  );

  const addByPath = useCallback(
    async (path: string) => {
      const { entry, list: l } = await addPath(entriesRef.current, path);
      show(entry, l);
      setLibraryOpen(false);
    },
    [show],
  );

  const remove = useCallback(
    (entry: Entry) => {
      if (
        !confirm(
          `Remove “${entry.name}” from the library?${entry.source.kind === "path" ? "\n\nThe file itself is not touched." : ""}`,
        )
      )
        return;
      setEntries(entriesRef.current.filter((e) => e.id !== entry.id));
      saveView(entry.id, null);
      if (entry.source.kind === "upload") deleteBytes(entry.id).catch(() => {});
      if (entry.id === activeId) {
        setActiveId(null);
        saveActive(null);
        setList(null);
        setSelected(null);
      }
    },
    [activeId, setEntries],
  );

  // Drop files anywhere.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      if (--depth <= 0) {
        depth = 0;
        setDragging(false);
      }
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      addFiles(Array.from(e.dataTransfer!.files));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [addFiles]);

  useEffect(() => {
    document.title = list ? `${list.name} · Pointmap` : "Pointmap";
  }, [list]);

  const onView = useCallback((v: View) => activeId && list && saveView(activeId, v), [activeId, list]);

  const pick = useCallback((id: number) => {
    setSelected({ kind: "place", id });
    setFlyTo((n) => n + 1);
  }, []);

  const active = entries.find((e) => e.id === activeId) ?? null;
  const selPlace = selected?.kind === "place" ? list?.places.find((p) => p.id === selected.id) : undefined;
  const selTrack = selected?.kind === "track" ? list?.tracks.find((t) => t.id === selected.id) : undefined;
  const starting = !list && loadingId != null && loadingId === activeId;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">Pointmap</span>
        </div>
        {active && list && (
          <button className="list-switch" onClick={() => setLibraryOpen(true)} title="Switch list">
            <span className="list-switch-name">{list.name}</span>
            <span className="dim small list-switch-count">{counts(active)}</span>
            <svg viewBox="0 0 16 16" aria-hidden>
              <path d="M4.5 6.5 8 10l3.5-3.5" />
            </svg>
          </button>
        )}
        {list && <Search list={list} onPick={pick} />}
        <div className="topbar-right">
          <ThemeSwitch value={theme} onChange={setTheme} />
          <button className="btn" onClick={() => setLibraryOpen(true)}>
            Library
          </button>
        </div>
      </header>

      <main className="main">
        <div className="map-wrap">
          <MapView
            list={list}
            listKey={activeId}
            initialView={initialView}
            dark={dark}
            selected={selected}
            flyTo={flyTo}
            pinScale={pins.scale}
            onPinScale={pins.setScale}
            onSelect={setSelected}
            onView={onView}
          >
            {selPlace ? <PlaceCard place={selPlace} /> : selTrack ? <TrackCard track={selTrack} /> : null}
          </MapView>
          {pins.hint && (
            <div className="pin-hint" role="status">
              Pin size {Math.round(pins.scale * 100)}%
              <span className="dim small">{MAC ? "⌘⇧" : "Ctrl+Shift"} + scroll</span>
            </div>
          )}
        </div>

        {!list && !starting && (
          <div className="welcome">
            <div className="welcome-card">
              <h1>Your places, on a map</h1>
              <p className="dim">
                Open a list exported from Organic Maps (.kmz or .kml) to see every point you've saved. Click a point to
                see what's known about it.
              </p>
              {active && errors[active.id] && (
                <p className="error">
                  Couldn't open “{active.name}”: {errors[active.id]}
                </p>
              )}
              <div className="row">
                <ChooseFiles onFiles={addFiles} primary />
                <span className="dim small">or drop it anywhere on the page</span>
              </div>
              {HAS_SERVER && (
                <>
                  <div className="welcome-or dim small">or open a file by its path on this computer</div>
                  <AddPath onAdd={addByPath} />
                </>
              )}
              {entries.length > 0 && (
                <div className="row">
                  <button className="btn" onClick={() => setLibraryOpen(true)}>
                    Open library · {entries.length} {entries.length === 1 ? "list" : "lists"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {starting && (
          <div className="loading">
            <span className="spinner" aria-hidden /> Opening {active?.name}…
          </div>
        )}

        {notice && (
          <div className="toast" role="alert">
            <span className="break">{notice}</span>
            <button className="btn btn-ghost btn-small" onClick={() => setNotice(null)} aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}

        {dragging && (
          <div className="dropzone">
            <div className="dropzone-card">Drop .kmz or .kml files to add them</div>
          </div>
        )}
      </main>

      {libraryOpen && (
        <Library
          entries={entries}
          activeId={activeId}
          loadingId={loadingId}
          errors={errors}
          onOpen={(e) => open(e).then((ok) => ok && setLibraryOpen(false))}
          onReload={(e) => open(e)}
          onRemove={remove}
          onFiles={addFiles}
          onAddPath={addByPath}
          onClose={() => setLibraryOpen(false)}
        />
      )}
    </div>
  );
}
