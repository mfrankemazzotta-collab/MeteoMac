// Descarga de datos diarios desde Open-Meteo.
// Nombres verificados en https://open-meteo.com/en/docs/historical-weather-api
// y probados contra la API real (octubre 2026).

import { cacheGet, cacheSet } from "./cache";
import { addDays } from "./dates";

const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

export const CLIMATE_START = "1991-01-01";

/** Modelos del reanálisis, con el nombre exacto que acepta el parámetro `models`. */
export type Model = "era5" | "era5_land";

export const MODEL_INFO: Record<Model, { label: string; resolution: string }> = {
  era5: { label: "ERA5", resolution: "grilla de 0,25°, ~25 km" },
  era5_land: { label: "ERA5-Land", resolution: "grilla de 0,1°, ~11 km" },
};

/**
 * Open-Meteo no publica precipitación para ERA5-Land: la serie llega entera en null
 * (verificado en varios puntos y períodos). Por eso, con ERA5-Land la temperatura sale
 * de ERA5-Land y la precipitación de ERA5, y la interfaz lo dice.
 */
export const PRECIP_SOURCE: Record<Model, Model> = {
  era5: "era5",
  era5_land: "era5",
};

export interface DailySeries {
  /** Fechas locales "AAAA-MM-DD", consecutivas. */
  dates: string[];
  /** Temperatura media diaria a 2 m (°C). */
  temp: (number | null)[];
  /** Precipitación diaria (mm). */
  precip: (number | null)[];
}

export interface PointData {
  model: Model;
  precipModel: Model;
  requested: { lat: number; lon: number };
  /** Centro de la celda de la grilla que devolvió la API. */
  grid: { lat: number; lon: number; elevation: number };
  timezone: string;
  /** Reanálisis consolidado, desde 1991-01-01 hasta `lastArchiveDate`. */
  archive: DailySeries;
  lastArchiveDate: string;
  /** Días posteriores al reanálisis, hasta hoy (API de pronóstico). Datos preliminares. */
  preliminary: DailySeries;
  /** Fecha de hoy en la zona horaria del lugar. */
  today: string;
}

interface ApiResponse {
  latitude: number;
  longitude: number;
  elevation: number;
  timezone: string;
  daily: Record<string, (number | null)[] | string[]>;
}

const HOUR = 3_600_000;

/**
 * GET con caché en el navegador. La URL completa es la clave, así que al cambiar
 * el end_date (un día nuevo) se hace una consulta nueva.
 */
async function getJson(url: string, maxAgeMs: number): Promise<ApiResponse> {
  const cached = await cacheGet<ApiResponse>(url, maxAgeMs);
  if (cached) return cached;

  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok || body.error) {
    const reason: string = body.reason ?? `HTTP ${res.status}`;
    // Open-Meteo cuenta una serie larga como muchas consultas y limita por minuto.
    if (res.status === 429 || /limit exceeded/i.test(reason)) {
      throw new ApiError("Open-Meteo limitó las consultas por un rato. Probá de nuevo en un minuto.");
    }
    throw new ApiError(reason);
  }
  await cacheSet(url, body);
  return body as ApiResponse;
}

export class ApiError extends Error {}

/**
 * Con un solo modelo la API devuelve `temperature_2m_mean`; con varios,
 * le agrega el sufijo del modelo: `temperature_2m_mean_era5_land`.
 */
function pick(daily: ApiResponse["daily"], variable: string, model: Model, multi: boolean) {
  const key = multi ? `${variable}_${model}` : variable;
  const values = daily[key];
  if (!values) throw new ApiError(`La respuesta no trae ${key}`);
  return values as (number | null)[];
}

/** Índice del último día con temperatura y precipitación. */
function lastCompleteIndex(s: DailySeries): number {
  for (let i = s.dates.length - 1; i >= 0; i--) {
    if (s.temp[i] != null && s.precip[i] != null) return i;
  }
  return -1;
}

function slice(s: DailySeries, from: number, to: number): DailySeries {
  return { dates: s.dates.slice(from, to), temp: s.temp.slice(from, to), precip: s.precip.slice(from, to) };
}

async function fetchArchive(lat: number, lon: number, model: Model) {
  const models = [...new Set([model, PRECIP_SOURCE[model]])];
  const multi = models.length > 1;
  const params = (endDate: string) =>
    new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      start_date: CLIMATE_START,
      end_date: endDate,
      daily: "temperature_2m_mean,precipitation_sum",
      timezone: "auto",
      models: models.join(","),
    });

  // La API no acepta end_date = hoy; pedimos hasta ayer (UTC). Si aun así se queja,
  // el mensaje trae la fecha máxima permitida y reintentamos una vez con esa.
  let endDate = addDays(new Date().toISOString().slice(0, 10), -1);
  let json: ApiResponse;
  try {
    json = await getJson(`${ARCHIVE_URL}?${params(endDate)}`, 12 * HOUR);
  } catch (e) {
    const max = e instanceof ApiError && /to (\d{4}-\d{2}-\d{2})/.exec(e.message)?.[1];
    if (!max) throw e;
    endDate = max;
    json = await getJson(`${ARCHIVE_URL}?${params(endDate)}`, 12 * HOUR);
  }

  const series: DailySeries = {
    dates: json.daily.time as string[],
    temp: pick(json.daily, "temperature_2m_mean", model, multi),
    precip: pick(json.daily, "precipitation_sum", PRECIP_SOURCE[model], multi),
  };
  // La API devuelve null en los últimos días (el reanálisis llega con ~5–7 días de atraso).
  const last = lastCompleteIndex(series);
  if (last < 0) throw new ApiError("El reanálisis no trajo datos para este punto");
  return { json, archive: slice(series, 0, last + 1) };
}

async function fetchPreliminary(lat: number, lon: number, lastArchiveDate: string) {
  // past_days admite hasta 92. Pedimos desde el día siguiente al reanálisis hasta hoy.
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: "temperature_2m_mean,precipitation_sum",
    timezone: "auto",
    past_days: "92",
    forecast_days: "1",
  });
  const json = await getJson(`${FORECAST_URL}?${params}`, HOUR);
  const all: DailySeries = {
    dates: json.daily.time as string[],
    temp: json.daily.temperature_2m_mean as (number | null)[],
    precip: json.daily.precipitation_sum as (number | null)[],
  };
  const today = all.dates[all.dates.length - 1];
  const from = all.dates.findIndex((d) => d > lastArchiveDate);
  const preliminary = from < 0 ? slice(all, 0, 0) : slice(all, from, all.dates.length);
  return { preliminary, today };
}

/** Una consulta al reanálisis (1991 → último día disponible) + una al pronóstico para el hueco. */
export async function fetchPointData(lat: number, lon: number, model: Model): Promise<PointData> {
  const { json, archive } = await fetchArchive(lat, lon, model);
  const lastArchiveDate = archive.dates[archive.dates.length - 1];
  const { preliminary, today } = await fetchPreliminary(lat, lon, lastArchiveDate);
  return {
    model,
    precipModel: PRECIP_SOURCE[model],
    requested: { lat, lon },
    grid: { lat: json.latitude, lon: json.longitude, elevation: json.elevation },
    timezone: json.timezone,
    archive,
    lastArchiveDate,
    preliminary,
    today,
  };
}
