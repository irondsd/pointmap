import { setWorkerUrl, type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// The bundled page can't find maplibre's worker next to itself; the server exposes it.
setWorkerUrl(new URL("/vendor/maplibre-gl-worker.mjs", location.href).href);

export const STYLE = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

/** Map style fonts (OpenFreeMap serves these glyphs). */
export const FONT = { regular: ["Noto Sans Regular"], bold: ["Noto Sans Bold"] };

/**
 * MapLibre opens the compact attribution expanded; on small screens it covers half the view.
 * Starts it collapsed (it's still one click on the ⓘ away).
 */
export function collapseAttribution(map: MlMap) {
  const collapse = () => {
    const el = map.getContainer().querySelector(".maplibregl-ctrl-attrib");
    el?.classList.remove("maplibregl-compact-show");
    el?.removeAttribute("open");
  };
  map.once("load", collapse);
  map.once("idle", collapse);
}

// ---------------------------------------------------------------- pins

export const PIN_PREFIX = "pin-";
export const pinId = (hex: string) => PIN_PREFIX + hex.replace("#", "");

/** Pixels below the pin's tip left for its shadow; the symbol layer offsets by this much. */
export const PIN_PAD = 3;
const HEAD_R = 7.5;
const STEM = 9;
/** From the tip to the top of the head, at size 1. */
export const PIN_HEIGHT = 2 * HEAD_R + STEM + 1;
/** Drawn large enough to stay sharp when the user scales pins up. */
export const PIN_RATIO = 4;

/** Organic Maps' bookmark pin: a round head with a white dot, on a thin stem down to the point. */
export function drawPin(hex: string): { width: number; height: number; data: Uint8ClampedArray } {
  const w = (HEAD_R + 1 + PIN_PAD) * 2;
  const cx = w / 2;
  const cy = PIN_PAD + HEAD_R + 1;
  const tip = cy + HEAD_R + STEM;
  const h = tip + PIN_PAD;
  const canvas = document.createElement("canvas");
  canvas.width = w * PIN_RATIO;
  canvas.height = h * PIN_RATIO;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(PIN_RATIO, PIN_RATIO);

  // Stem: a white outline under the colored line keeps it visible on any background.
  const stem = (width: number, color: string) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, tip);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  };
  ctx.lineCap = "butt";
  stem(3.5, "rgb(255 255 255 / 0.9)");
  stem(1.75, hex);

  // Head, with a soft shadow.
  ctx.save();
  ctx.shadowColor = "rgb(0 0 0 / 0.35)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, HEAD_R, 0, 2 * Math.PI);
  ctx.fillStyle = hex;
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 2.75, 0, 2 * Math.PI);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
}
