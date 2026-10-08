// Días con lluvia, despejados, parcialmente nublados y nublados. Funciones puras.

import { BASE_END, BASE_START, periodYear } from "./climatology";
import type { DailySeries } from "./openmeteo";

export type SkyCategory = "rain" | "cloudy" | "partly" | "clear";
/** Orden de apilado: de abajo (lluvia) hacia arriba (despejado). */
export const SKY_CATEGORIES: SkyCategory[] = ["rain", "cloudy", "partly", "clear"];

export const SKY_INFO: Record<SkyCategory, { label: string; short: string }> = {
  rain: { label: "Con lluvia (≥ 1 mm)", short: "con lluvia" },
  cloudy: { label: "Nublado (≥ 75 %)", short: "nublados" },
  partly: { label: "Parcialmente nublado", short: "parciales" },
  clear: { label: "Despejado (≤ 25 %)", short: "despejados" },
};

/** Umbral de "día con lluvia" de la OMM. */
export const RAIN_DAY_MM = 1;
/** Nubosidad media: ≤ 2 octas ≈ despejado; ≥ 6 octas ≈ nublado. */
export const CLEAR_MAX = 25;
export const CLOUDY_MIN = 75;

/**
 * Categoría del día. La lluvia manda: un día con ≥ 1 mm cuenta como "con lluvia" aunque
 * haya tenido sol. Si falta el dato necesario, devuelve null.
 */
export function classifyDay(precip: number | null, cloud: number | null): SkyCategory | null {
  if (precip != null && precip >= RAIN_DAY_MM) return "rain";
  if (cloud == null || precip == null) return null;
  if (cloud >= CLOUDY_MIN) return "cloudy";
  if (cloud <= CLEAR_MAX) return "clear";
  return "partly";
}

export type Counts = Record<SkyCategory, number>;
const zero = (): Counts => ({ rain: 0, cloudy: 0, partly: 0, clear: 0 });

export interface MonthSky {
  /** Mes calendario 1..12. */
  month: number;
  /** Posición en el período (0 = primer mes: enero, o abril en el año hidrológico). */
  order: number;
  counts: Counts;
  /** Días clasificados en el mes (puede ser menos que el largo del mes si está en curso). */
  days: number;
  daysInMonth: number;
  preliminaryDays: number;
  /** Promedio 1991–2020 de cada categoría en ese mes, ajustado a los días observados. */
  normal: Counts;
}

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Promedio por mes (1..12) de cada categoría en los años base, por día del mes (fracción). */
export function skyNormals(archive: DailySeries, baseStart = BASE_START, baseEnd = BASE_END) {
  // Fracción de días de cada categoría por mes: robusto ante años bisiestos o días faltantes.
  const tally = Array.from({ length: 12 }, () => ({ counts: zero(), days: 0 }));
  archive.dates.forEach((iso, i) => {
    const y = Number(iso.slice(0, 4));
    if (y < baseStart || y > baseEnd) return;
    const c = classifyDay(archive.precip[i], archive.cloud[i]);
    if (!c) return;
    const t = tally[Number(iso.slice(5, 7)) - 1];
    t.counts[c]++;
    t.days++;
  });
  return tally.map((t) => {
    const f = zero();
    for (const c of SKY_CATEGORIES) f[c] = t.days ? t.counts[c] / t.days : 0;
    return f;
  });
}

/**
 * Cuenta las categorías mes a mes en el período `year` (año calendario o hidrológico) y
 * le pone al lado la normal 1991–2020 para los mismos días observados.
 */
export function monthlySky(
  series: { archive: DailySeries; preliminary: DailySeries },
  normals: Counts[],
  year: number,
  startMonth = 1,
): MonthSky[] {
  const months = new Map<number, MonthSky>();
  for (let k = 0; k < 12; k++) {
    const month = ((startMonth - 1 + k) % 12) + 1;
    const calYear = month >= startMonth ? year : year + 1;
    months.set(month, { month, order: k, counts: zero(), days: 0, daysInMonth: daysIn(calYear, month), preliminaryDays: 0, normal: zero() });
  }
  const add = (s: DailySeries, preliminary: boolean) => {
    s.dates.forEach((iso, i) => {
      if (periodYear(iso, startMonth) !== year) return;
      const c = classifyDay(s.precip[i], s.cloud[i]);
      if (!c) return;
      const m = months.get(Number(iso.slice(5, 7)))!;
      m.counts[c]++;
      m.days++;
      if (preliminary) m.preliminaryDays++;
    });
  };
  add(series.archive, false);
  add(series.preliminary, true);
  for (const m of months.values()) {
    for (const c of SKY_CATEGORIES) m.normal[c] = normals[m.month - 1][c] * m.days;
  }
  return [...months.values()].sort((a, b) => a.order - b.order);
}

/** Totales del período: lo observado y la normal para los mismos días. */
export function skyTotals(months: MonthSky[]) {
  const counts = zero();
  const normal = zero();
  let days = 0;
  for (const m of months) {
    days += m.days;
    for (const c of SKY_CATEGORIES) {
      counts[c] += m.counts[c];
      normal[c] += m.normal[c];
    }
  }
  return { counts, normal, days };
}
