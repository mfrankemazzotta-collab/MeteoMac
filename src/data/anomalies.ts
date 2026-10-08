// Anomalías de temperatura respecto de 1991–2020, para las franjas y el calendario.
// Funciones puras: no tocan la interfaz ni la red.

import { doy365, periodIndex, periodYear, quantile, type Climatology } from "./climatology";
import type { DailySeries } from "./openmeteo";

export type TempVar = "mean" | "max" | "min";
export const TEMP_VARS: TempVar[] = ["mean", "max", "min"];

export const TEMP_VAR_INFO: Record<TempVar, { label: string; key: "temp" | "tmax" | "tmin" }> = {
  mean: { label: "media", key: "temp" },
  max: { label: "máxima", key: "tmax" },
  min: { label: "mínima", key: "tmin" },
};

export interface DayAnomaly {
  iso: string;
  /** Año (o año de inicio del período hidrológico) al que pertenece el día. */
  year: number;
  /** Posición dentro del período (0..364), para ubicarlo en el calendario. */
  index: number;
  value: number;
  /** Valor del día − promedio 1991–2020 de ese día (°C). */
  anomaly: number;
  preliminary: boolean;
}

/**
 * Anomalía de cada día: el valor menos el promedio climatológico de ese día del año
 * (la misma ventana de ±7 días que la banda). Los días sin dato se omiten.
 */
export function dailyAnomalies(
  series: { archive: DailySeries; preliminary: DailySeries },
  clim: Climatology,
  variable: TempVar,
  startMonth = 1,
): DayAnomaly[] {
  const key = TEMP_VAR_INFO[variable].key;
  const out: DayAnomaly[] = [];
  const add = (s: DailySeries, preliminary: boolean) => {
    s.dates.forEach((iso, i) => {
      const value = s[key][i];
      if (value == null) return;
      out.push({
        iso,
        year: periodYear(iso, startMonth),
        index: periodIndex(iso, startMonth),
        value,
        anomaly: value - clim.mean[doy365(iso)],
        preliminary,
      });
    });
  };
  add(series.archive, false);
  add(series.preliminary, true);
  return out;
}

export interface YearAnomaly {
  year: number;
  /** Promedio de las anomalías diarias del período (°C). */
  anomaly: number;
  days: number;
  /** El período está completo (365 días o más). */
  complete: boolean;
}

/**
 * Anomalía de cada año como el promedio de sus anomalías diarias. Para un año completo es
 * lo mismo que (media del año − media normal); para el año en curso compara solo los días
 * transcurridos con lo normal para esos mismos días, así no lo sesga la estación.
 */
export function yearlyAnomalies(days: DayAnomaly[]): YearAnomaly[] {
  const byYear = new Map<number, { sum: number; days: number }>();
  for (const d of days) {
    const y = byYear.get(d.year) ?? { sum: 0, days: 0 };
    y.sum += d.anomaly;
    y.days++;
    byYear.set(d.year, y);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, y]) => ({ year, anomaly: y.sum / y.days, days: y.days, complete: y.days >= 365 }));
}

/**
 * Límite simétrico para la escala de colores: el percentil `q` del valor absoluto,
 * redondeado hacia arriba a `step`. Así unos pocos días extremos no lavan el resto de colores.
 */
export function symmetricLimit(values: number[], q = 0.98, step = 1): number {
  if (values.length === 0) return step;
  const abs = values.map(Math.abs).sort((a, b) => a - b);
  return Math.max(step, Math.ceil(quantile(abs, q) / step) * step);
}

/**
 * Fecha de referencia para dibujar el día en un calendario común a todos los años.
 * Se usa un año bisiesto (2000) para que el 29/2 tenga su lugar; en el año hidrológico,
 * abril–diciembre van en 1999 y enero–marzo en 2000.
 */
export function referenceDate(iso: string, startMonth = 1): Date {
  const month = Number(iso.slice(5, 7));
  const refYear = startMonth > 1 && month >= startMonth ? 1999 : 2000;
  return new Date(`${refYear}${iso.slice(4)}T00:00:00Z`);
}
