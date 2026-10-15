import { parseListFile } from "./kml";
import type { PlaceList } from "./places";

/**
 * The library remembers lists two ways:
 * - by path on disk: only the path is kept (localStorage) and the file is re-read on every open,
 *   so re-exporting from Organic Maps to the same place just works;
 * - by upload (picker / drag & drop): the browser can't know where a file came from,
 *   so its bytes are kept in IndexedDB instead.
 */
export type Source = { kind: "path"; path: string } | { kind: "upload"; fileName: string };

export interface Entry {
  id: string;
  name: string;
  source: Source;
  places: number;
  tracks: number;
  addedAt: number;
  openedAt: number;
}

export interface View {
  center: [number, number];
  zoom: number;
}

const KEY = "pt.library";
const ACTIVE = "pt.active";
const viewKey = (id: string) => `pt.view.${id}`;

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable; the library just won't be remembered.
  }
}

export const loadEntries = (): Entry[] => read<Entry[]>(KEY, []);
export const saveEntries = (entries: Entry[]) => write(KEY, entries);
export const loadActive = (): string | null => read<string | null>(ACTIVE, null);
export const saveActive = (id: string | null) => write(ACTIVE, id);
export const loadView = (id: string): View | null => read<View | null>(viewKey(id), null);
export const saveView = (id: string, view: View | null) => write(viewKey(id), view);

// ---------------------------------------------------------------- IndexedDB (uploaded files)

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("pointmap", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = run(d.transaction("files", mode).objectStore("files"));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).finally(() => d.close()) as Promise<T>;
}

const putBytes = (id: string, bytes: Uint8Array) => tx("readwrite", (s) => s.put(bytes, id));
const getBytes = (id: string) => tx<Uint8Array | undefined>("readonly", (s) => s.get(id));
export const deleteBytes = (id: string) => tx("readwrite", (s) => s.delete(id));

// ---------------------------------------------------------------- loading

async function fetchPath(path: string): Promise<{ bytes: Uint8Array; resolved: string }> {
  const r = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    throw new Error(j?.error ?? r.statusText);
  }
  const resolved = decodeURIComponent(r.headers.get("x-file-path") ?? encodeURIComponent(path));
  return { bytes: new Uint8Array(await r.arrayBuffer()), resolved };
}

/** Reads and parses a library entry's file. */
export async function openEntry(entry: Entry): Promise<PlaceList> {
  if (entry.source.kind === "path") return parseListFile((await fetchPath(entry.source.path)).bytes);
  const bytes = await getBytes(entry.id);
  if (!bytes) throw new Error("The stored copy of this file is gone. Add it again.");
  return parseListFile(bytes);
}

const newId = () => Math.random().toString(36).slice(2, 10);

function entryFor(list: PlaceList, source: Source, existing: Entry | undefined): Entry {
  const now = Date.now();
  return {
    id: existing?.id ?? newId(),
    name: list.name,
    source,
    places: list.places.length,
    tracks: list.tracks.length,
    addedAt: existing?.addedAt ?? now,
    openedAt: now,
  };
}

/** Adds (or refreshes) a list by its path on disk. */
export async function addPath(entries: Entry[], path: string): Promise<{ entry: Entry; list: PlaceList }> {
  const { bytes, resolved } = await fetchPath(path);
  const list = await parseListFile(bytes);
  const existing = entries.find((e) => e.source.kind === "path" && e.source.path === resolved);
  return { entry: entryFor(list, { kind: "path", path: resolved }, existing), list };
}

/** Adds an uploaded file, replacing an earlier upload of the same list. */
export async function addUpload(entries: Entry[], file: File): Promise<{ entry: Entry; list: PlaceList }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const list = await parseListFile(bytes);
  const existing = entries.find(
    (e) => e.source.kind === "upload" && (e.source.fileName === file.name || e.name === list.name),
  );
  const entry = entryFor(list, { kind: "upload", fileName: file.name }, existing);
  await putBytes(entry.id, bytes);
  // Asks the browser not to clear the stored files under storage pressure. Chrome decides without a prompt.
  navigator.storage?.persist?.().catch(() => {});
  return { entry, list };
}

/** Replaces an entry in place, or appends it when it's new. */
export function upsert(entries: Entry[], entry: Entry): Entry[] {
  return entries.some((e) => e.id === entry.id)
    ? entries.map((e) => (e.id === entry.id ? entry : e))
    : [...entries, entry];
}

export function sourceLabel(s: Source): string {
  return s.kind === "path" ? s.path.replace(/^\/(Users|home)\/[^/]+(?=\/)/, "~") : `Uploaded · ${s.fileName}`;
}
