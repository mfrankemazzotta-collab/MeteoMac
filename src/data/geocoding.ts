// Buscador de lugares con la API de geocoding de Open-Meteo.
// https://open-meteo.com/en/docs/geocoding-api — sin resultados, la respuesta no trae `results`.

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";

export interface Place {
  name: string;
  /** "Provincia, País", para distinguir lugares con el mismo nombre. */
  detail: string;
  lat: number;
  lon: number;
}

interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const name = query.trim();
  if (name.length < 2) return [];
  const params = new URLSearchParams({ name, count: "8", language: "es", format: "json" });
  const res = await fetch(`${GEOCODING_URL}?${params}`, { signal });
  if (!res.ok) throw new Error(`Búsqueda: HTTP ${res.status}`);
  const body: { results?: GeoResult[] } = await res.json();
  return (body.results ?? []).map((r) => ({
    name: r.name,
    detail: [r.admin1, r.country].filter(Boolean).join(", "),
    lat: r.latitude,
    lon: r.longitude,
  }));
}
