// Estado de la página <-> parámetros de la URL, para poder compartir enlaces.
// Ejemplo: ?lat=-41.1082&lon=-71.4341&lugar=Bariloche&anio=2026&modelo=era5-land&hidro=1&comparar=1

import { MODELS, type Model } from "./data/openmeteo";

export interface AppState {
  lat: number;
  lon: number;
  /** Nombre del lugar; null si se llegó con coordenadas sueltas. */
  name: string | null;
  /** Año (o año de inicio del período hidrológico); null = el actual. */
  year: number | null;
  model: Model;
  hydro: boolean;
  compare: boolean;
}

export const DEFAULT_STATE: AppState = {
  lat: -41.1082,
  lon: -71.4341,
  name: "Bariloche",
  year: null,
  model: "era5_land",
  hydro: false,
  compare: false,
};

export const FIRST_YEAR = 1991;

/** En la URL usamos guion (era5-land), que se lee mejor que el guion bajo. */
const modelToUrl = (m: Model) => m.replace("_", "-");
const modelFromUrl = (s: string | null) => MODELS.find((m) => modelToUrl(m) === s || m === s);

function numberIn(s: string | null, min: number, max: number): number | null {
  if (s == null || s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Lee el estado de la URL; lo que falte o no sea válido toma el valor por defecto. */
export function parseState(search: string): AppState {
  const p = new URLSearchParams(search);
  const lat = numberIn(p.get("lat"), -90, 90);
  const lon = numberIn(p.get("lon"), -180, 180);
  const hasCoords = lat != null && lon != null;
  const year = numberIn(p.get("anio"), FIRST_YEAR, 2100);
  return {
    lat: hasCoords ? lat : DEFAULT_STATE.lat,
    lon: hasCoords ? lon : DEFAULT_STATE.lon,
    // Un nombre sin sus coordenadas no sirve; coordenadas sin nombre, sí.
    name: hasCoords ? p.get("lugar")?.trim() || null : DEFAULT_STATE.name,
    year: year != null && Number.isInteger(year) ? year : null,
    model: modelFromUrl(p.get("modelo")) ?? DEFAULT_STATE.model,
    hydro: p.get("hidro") === "1",
    compare: p.get("comparar") === "1",
  };
}

/** Coordenadas con 4 decimales (~10 m): suficiente y deja URLs cortas. */
export const roundCoord = (x: number) => Math.round(x * 1e4) / 1e4;

export function serializeState(s: AppState): string {
  const p = new URLSearchParams();
  p.set("lat", String(roundCoord(s.lat)));
  p.set("lon", String(roundCoord(s.lon)));
  if (s.name) p.set("lugar", s.name);
  if (s.year != null) p.set("anio", String(s.year));
  p.set("modelo", modelToUrl(s.model));
  if (s.hydro) p.set("hidro", "1");
  if (s.compare) p.set("comparar", "1");
  return `?${p}`;
}

/** "2026" para año calendario; "2025–26" para el año hidrológico que empieza en abril de 2025. */
export function periodLabel(year: number, hydro: boolean): string {
  return hydro ? `${year}–${String(year + 1).slice(2)}` : String(year);
}
