import { useEffect, useRef, useState } from "react";
import { sourceLabel, type Entry } from "./store";
import { HAS_SERVER } from "./env";
import { nf } from "./places";

export const ACCEPT = ".kmz,.kml";

export function counts(e: { places: number; tracks: number }): string {
  const parts = [`${nf.format(e.places)} ${e.places === 1 ? "place" : "places"}`];
  if (e.tracks) parts.push(`${nf.format(e.tracks)} ${e.tracks === 1 ? "track" : "tracks"}`);
  return parts.join(" · ");
}

export function ChooseFiles({ onFiles, primary }: { onFiles(files: File[]): void; primary?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className={`btn ${primary ? "btn-primary" : ""}`} onClick={() => input.current?.click()}>
        Choose .kmz file…
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}

export function AddPath({ onAdd, autoFocus }: { onAdd(path: string): Promise<void>; autoFocus?: boolean }) {
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!path.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(path.trim());
      setPath("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="add-path" onSubmit={submit}>
      <div className="row">
        <input
          className="input mono"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="~/Downloads/My places.kmz"
          autoFocus={autoFocus}
          spellCheck={false}
          aria-label="Path to a .kmz file"
        />
        <button className="btn" disabled={busy || !path.trim()}>
          {busy ? "Opening…" : "Open"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
    </form>
  );
}

export function Library(props: {
  entries: Entry[];
  activeId: string | null;
  loadingId: string | null;
  errors: Record<string, string>;
  onOpen(e: Entry): void;
  onReload(e: Entry): void;
  onRemove(e: Entry): void;
  onFiles(files: File[]): void;
  onAddPath(path: string): Promise<void>;
  onClose(): void;
}) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="drawer-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-label="Library">
        <header className="drawer-head">
          <h2>Library</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <section>
          <h4>Lists</h4>
          {props.entries.length === 0 && (
            <p className="dim">Nothing here yet. Add an export from Organic Maps below.</p>
          )}
          <ul className="lists">
            {props.entries.map((e) => {
              const active = e.id === props.activeId;
              const loading = e.id === props.loadingId;
              return (
                <li key={e.id} className={active ? "active" : undefined}>
                  <button className="list-open" onClick={() => props.onOpen(e)} disabled={loading}>
                    <span className="list-name">
                      {e.name}
                      {active && <span className="badge">Showing</span>}
                      {loading && <span className="spinner" aria-label="Loading" />}
                    </span>
                    <span className="dim small">{counts(e)}</span>
                    <span className="dim small mono break">{sourceLabel(e.source)}</span>
                  </button>
                  {props.errors[e.id] && <div className="error">{props.errors[e.id]}</div>}
                  <div className="row">
                    {e.source.kind === "path" && (
                      <button className="btn btn-small" onClick={() => props.onReload(e)} disabled={loading}>
                        Reload
                      </button>
                    )}
                    <button className="btn btn-small btn-danger" onClick={() => props.onRemove(e)}>
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h4>Add a list</h4>
          <div className="row">
            <ChooseFiles onFiles={props.onFiles} primary={props.entries.length === 0} />
            <span className="dim small">or drop files anywhere</span>
          </div>
          <p className="dim small">A copy is kept in this browser.</p>
          {HAS_SERVER && (
            <>
              <h4>Open by path</h4>
              <AddPath onAdd={props.onAddPath} />
              <p className="dim small">
                Only the path is remembered and the file is re-read every time, so re-exporting from Organic Maps to the
                same place keeps the map up to date.
              </p>
            </>
          )}
        </section>

        <section>
          <h4>Exporting from Organic Maps</h4>
          <p className="dim small">
            Open Bookmarks and Tracks, tap ⋯ next to a list and choose Export. Send the .kmz to your computer and add it
            here.
          </p>
        </section>
      </div>
    </div>
  );
}
