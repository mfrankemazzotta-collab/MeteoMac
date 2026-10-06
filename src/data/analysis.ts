// Cruza la serie de un año con la climatología. Funciones puras, sin interfaz.

import { accumulationClimatology, dailyClimatology, doy365, percentileRank, periodIndex, periodYear, type Climatology } from "./climatology";
import { addDays } from "./dates";
import type { DailySeries } from "./openmeteo";

export interface PointClimatology {
  startMonth: number;
  temp: Climatology;
  precipAcc: Climatology & { years: number };
}

/** Climatología de temperatura y de lluvia acumulada a partir del reanálisis (1991–2020). */
export function buildClimatology(archive: DailySeries, startMonth = 1): PointClimatology {
  return {
    startMonth,
    temp: dailyClimatology(archive.dates, archive.temp),
    precipAcc: accumulationClimatology(archive.dates, archive.precip, { startMonth }),
  };
}

export type Outside = "above" | "below" | null;

export interface DayRow {
  date: Date;
  iso: string;
  temp: number | null;
  precip: number | null;
  /** Lluvia acumulada desde el inicio del período (mm). */
  precipAcc: number;
  preliminary: boolean;
  /** Percentil del día respecto de su distribución 1991–2020 (0–100). */
  tempPct: number | null;
  precipAccPct: number;
  /** Si la temperatura quedó por encima del p90 o por debajo del p10. */
  tempOutside: Outside;
}

export interface BandRow {
  date: Date;
  iso: string;
  t10: number;
  t50: number;
  t90: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface Summary {
  lastDate: string;
  days: number;
  preliminaryDays: number;
  rainAcc: number;
  rainMedian: number;
  /** Lluvia acumulada como % de la mediana a la misma fecha. */
  rainPctOfMedian: number | null;
  /** Promedio de (T del día − T media 1991–2020 de ese día), en °C. */
  tempAnomaly: number | null;
}

export interface YearAnalysis {
  year: number;
  startMonth: number;
  periodStart: string;
  periodEnd: string;
  rows: DayRow[];
  band: BandRow[];
  summary: Summary;
}

const toDate = (iso: string) => new Date(iso + "T00:00:00Z");
const pad = (n: number) => String(n).padStart(2, "0");

/** Todas las fechas del período que empieza el 1 de `startMonth` del año `year`. */
export function periodDates(year: number, startMonth = 1): string[] {
  const start = `${year}-${pad(startMonth)}-01`;
  const next = `${year + 1}-${pad(startMonth)}-01`;
  const out: string[] = [];
  for (let d = start; d < next; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Analiza el período `year` (año calendario, o abril `year`–marzo `year+1` si startMonth = 4):
 * días observados con percentiles, banda climatológica para todo el período y resumen.
 */
export function analyzeYear(
  series: { archive: DailySeries; preliminary: DailySeries },
  clim: PointClimatology,
  year: number,
): YearAnalysis {
  const { startMonth } = clim;
  const rows: DayRow[] = [];
  let acc = 0;
  let anomalySum = 0;
  let anomalyDays = 0;

  const push = (iso: string, temp: number | null, precip: number | null, preliminary: boolean) => {
    if (periodYear(iso, startMonth) !== year) return;
    const d = doy365(iso);
    const idx = periodIndex(iso, startMonth);
    acc += precip ?? 0;
    let tempPct: number | null = null;
    let tempOutside: Outside = null;
    if (temp != null) {
      tempPct = percentileRank(clim.temp.pools[d], temp);
      if (temp > clim.temp.p90[d]) tempOutside = "above";
      else if (temp < clim.temp.p10[d]) tempOutside = "below";
      anomalySum += temp - clim.temp.mean[d];
      anomalyDays++;
    }
    rows.push({
      date: toDate(iso),
      iso,
      temp,
      precip,
      precipAcc: acc,
      preliminary,
      tempPct,
      precipAccPct: percentileRank(clim.precipAcc.pools[idx], acc),
      tempOutside,
    });
  };
  const { archive, preliminary } = series;
  archive.dates.forEach((d, i) => push(d, archive.temp[i], archive.precip[i], false));
  preliminary.dates.forEach((d, i) => push(d, preliminary.temp[i], preliminary.precip[i], true));

  const dates = periodDates(year, startMonth);
  const band: BandRow[] = dates.map((iso) => {
    const d = doy365(iso);
    const idx = periodIndex(iso, startMonth);
    const t = clim.temp;
    const p = clim.precipAcc;
    return { date: toDate(iso), iso, t10: t.p10[d], t50: t.p50[d], t90: t.p90[d], p10: p.p10[idx], p50: p.p50[idx], p90: p.p90[idx] };
  });

  const last = rows[rows.length - 1];
  const rainMedian = last ? clim.precipAcc.p50[periodIndex(last.iso, startMonth)] : NaN;
  const summary: Summary = {
    lastDate: last?.iso ?? "",
    days: rows.length,
    preliminaryDays: rows.filter((r) => r.preliminary).length,
    rainAcc: acc,
    rainMedian,
    rainPctOfMedian: last && rainMedian > 0 ? (acc / rainMedian) * 100 : null,
    tempAnomaly: anomalyDays > 0 ? anomalySum / anomalyDays : null,
  };

  return { year, startMonth, periodStart: dates[0], periodEnd: dates[dates.length - 1], rows, band, summary };
}
