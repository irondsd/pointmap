# Pointmap

Shows the places you've saved in [Organic Maps](https://organicmaps.app) on a map. Export a list from the app
(Bookmarks and Tracks → ⋯ → Export) and open the `.kmz` here. Plain `.kml` files from other apps work too.

```bash
bun install
bun run dev        # http://localhost:3001
```

- **Library**: add lists by choosing or dropping a file (a copy is kept in the browser's IndexedDB) or by path on
  this computer (only the path is kept, and the file is re-read on every open, so re-exporting to the same place
  updates the map). The library, the open list and each list's last map view live in localStorage.
- **Map**: every pin is drawn in its Organic Maps color and shape, overlapping like in the app, with names from zoom 12.
  Hold ⌘⇧ (Ctrl+Shift elsewhere) and scroll over the map to make pins bigger or smaller. Tracks are drawn as
  lines.
- **Search** (`/`) by name, any of its other-language names, category or description.
- **Popup** for a place: name, what it is (from Organic Maps' feature types, e.g. "Railway station"), its names in other
  languages, description, accessibility, when it was saved, color, coordinates (click to copy), and links to open it in
  Organic Maps, OpenStreetMap or Google Maps.

Set `PORT` or `HOST` to change where it listens. The server only answers requests addressed to localhost.

## Deploying (Vercel)

`bun run build` makes a static site in `dist/`: everything runs in the browser, so no server is needed. Opening files
by path is local-only and left out of that build. Add lists by choosing or dropping a file; they stay in that browser's
IndexedDB.

Import the repo in Vercel; [vercel.json](vercel.json) sets up the build. Or from this folder:

```bash
bunx vercel --prod
```

```bash
bun test
bun check
bun fmt
```
