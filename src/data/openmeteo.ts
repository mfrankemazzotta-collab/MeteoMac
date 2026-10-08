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
export const MODELS: Model[] = ["era5", "era5_land"];

export const MODEL_INFO: Record<Model, { label: string; resolution: string }> = {
  era5: { label: "ERA5", resolution: "grilla de 0,25°, ~25 km" },
  era5_land: { label: "ERA5-Land", resolution: "grilla de 0,1°, ~11 km" },
};

/**
 * Open-Meteo no publica precipitación para ERA5-Land: la serie llega entera en null
 * (verificado en varios puntos y períodos). Por eso la lluvia sale siempre de ERA5,
 * y la interfaz lo dice.
 */
export const PRECIP_MODEL: Model = "era5";

export interface DailySeries {
  /** Fechas locales "AAAA-MM-DD", consecutivas. */
  dates: string[];
  /** Temperatura media diaria a 2 m (°C). */
  temp: (number | null)[];
  /** Temperatura máxima y mínima diarias a 2 m (°C). */
  tmax: (number | null)[];
  tmin: (number | null)[];
  /** Precipitación diaria (mm). */
  precip: (number | null)[];
}

export interface PointData {
  /** Modelos con temperatura en esta respuesta. */
  models: Model[];
  requested: { lat: number; lon: number };
  /** Elevación que usa Open-Meteo para corregir la temperatura (m). */
  elevation: number;
  timezone: string;
  /** Reanálisis consolidado por modelo, desde 1991-01-01 hasta `lastArchiveDate`. */
  archive: Partial<Record<Model, DailySeries>>;
  lastArchiveDate: string;
  /** Días posteriores al reanálisis, hasta hoy (API de pronóstico). Datos preliminares. */
  preliminary: DailySeries;
  /** Fecha de hoy en la zona horaria del lugar. */
  today: string;
}

/** Serie de un modelo: su reanálisis + los días preliminares (comunes a todos los modelos). */
export function seriesFor(data: PointData, model: Model) {
  const archive = data.archive[model];
  if (!archive) throw new Error(`No hay datos de ${MODEL_INFO[model].label}`);
  return { archive, preliminary: data.preliminary };
}

interface ApiResponse {
  latitude: number;
  longitude: number;
  elevation: number;
  timezone: string;
  daily: Record<string, (number | null)[] | string[]>;
}

const HOUR = 3_600_000;

/** Variables diarias. Son 4: hasta 10 Open-Meteo las cuenta como una sola consulta. */
const DAILY_VARS = "temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum";

export class ApiError extends Error {}

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

function slice(s: DailySeries, from: number, to: number): DailySeries {
  return {
    dates: s.dates.slice(from, to),
    temp: s.temp.slice(from, to),
    tmax: s.tmax.slice(from, to),
    tmin: s.tmin.slice(from, to),
    precip: s.precip.slice(from, to),
  };
}

/** Modelos a pedir: los elegidos más ERA5 para la lluvia, en orden fijo (así comparten caché). */
export function archiveModels(models: Model[]): Model[] {
  return MODELS.filter((m) => m === PRECIP_MODEL || models.includes(m));
}

async function fetchArchive(lat: number, lon: number, models: Model[]) {
  const multi = models.length > 1;
  const params = (endDate: string) =>
    new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      start_date: CLIMATE_START,
      end_date: endDate,
      daily: DAILY_VARS,
      timezone: "auto",
      models: models.join(","),
    });

  // La API no acepta end_date = hoy; pedimos hasta ayer (UTC). Si aun así se queja,
  // el mensaje trae la fecha máxima permitida y reintentamos una vez con esa.
  const endDate = addDays(new Date().toISOString().slice(0, 10), -1);
  let json: ApiResponse;
  try {
    json = await getJson(`${ARCHIVE_URL}?${params(endDate)}`, 12 * HOUR);
  } catch (e) {
    const max = e instanceof ApiError && /to (\d{4}-\d{2}-\d{2})/.exec(e.message)?.[1];
    if (!max) throw e;
    json = await getJson(`${ARCHIVE_URL}?${params(max)}`, 12 * HOUR);
  }

  const dates = json.daily.time as string[];
  const precip = pick(json.daily, "precipitation_sum", PRECIP_MODEL, multi);
  const temps = models.map((m) => pick(json.daily, "temperature_2m_mean", m, multi));
  const tmaxs = models.map((m) => pick(json.daily, "temperature_2m_max", m, multi));
  const tmins = models.map((m) => pick(json.daily, "temperature_2m_min", m, multi));

  // La API devuelve null en los últimos días (el reanálisis llega con ~5–7 días de atraso).
  // Cortamos en el último día en que todos los modelos tienen temperatura y hay lluvia.
  let last = dates.length - 1;
  while (last >= 0 && (precip[last] == null || temps.some((t) => t[last] == null))) last--;
  if (last < 0) throw new ApiError("El reanálisis no trajo datos para este punto");

  const archive: Partial<Record<Model, DailySeries>> = {};
  models.forEach(
    (m, i) => (archive[m] = slice({ dates, temp: temps[i], tmax: tmaxs[i], tmin: tmins[i], precip }, 0, last + 1)),
  );
  return { json, archive, lastArchiveDate: dates[last] };
}

async function fetchPreliminary(lat: number, lon: number, lastArchiveDate: string) {
  // past_days admite hasta 92. Pedimos desde el día siguiente al reanálisis hasta hoy.
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: DAILY_VARS,
    timezone: "auto",
    past_days: "92",
    forecast_days: "1",
  });
  const json = await getJson(`${FORECAST_URL}?${params}`, HOUR);
  const all: DailySeries = {
    dates: json.daily.time as string[],
    temp: json.daily.temperature_2m_mean as (number | null)[],
    tmax: json.daily.temperature_2m_max as (number | null)[],
    tmin: json.daily.temperature_2m_min as (number | null)[],
    precip: json.daily.precipitation_sum as (number | null)[],
  };
  const today = all.dates[all.dates.length - 1];
  const from = all.dates.findIndex((d) => d > lastArchiveDate);
  const preliminary = from < 0 ? slice(all, 0, 0) : slice(all, from, all.dates.length);
  return { preliminary, today };
}

/**
 * Una consulta al reanálisis (1991 → último día disponible, todos los modelos juntos)
 * y una al pronóstico para completar el hueco hasta hoy.
 */
export async function fetchPointData(lat: number, lon: number, models: Model[]): Promise<PointData> {
  const requestModels = archiveModels(models);
  const { json, archive, lastArchiveDate } = await fetchArchive(lat, lon, requestModels);
  const { preliminary, today } = await fetchPreliminary(lat, lon, lastArchiveDate);
  return {
    models: requestModels,
    requested: { lat, lon },
    elevation: json.elevation,
    timezone: json.timezone,
    archive,
    lastArchiveDate,
    preliminary,
    today,
  };
}
