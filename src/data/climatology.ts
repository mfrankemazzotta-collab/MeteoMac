// Climatología diaria 1991–2020. Funciones puras: no tocan la interfaz ni la red.
//
// Calendario de 365 posiciones: el 29 de febrero se trata como si fuera el 28
// (comparten posición). Así un año bisiesto no corre un día todas las fechas
// desde marzo y la ventana de ±7 días funciona igual todos los años.

export const BASE_START = 1991;
export const BASE_END = 2020;
export const DAYS = 365;

/** Posiciones acumuladas de cada mes en un año no bisiesto. */
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** Posición 0..364 de una fecha "AAAA-MM-DD". El 29/2 cae en la misma posición que el 28/2. */
export function doy365(iso: string): number {
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return MONTH_START[month - 1] + Math.min(day, month === 2 ? 28 : 31) - 1;
}

/**
 * Posición dentro de un período que empieza el día 1 de `startMonth`
 * (1 = año calendario, 4 = año hidrológico abril–marzo).
 */
export function periodIndex(iso: string, startMonth = 1): number {
  return (doy365(iso) - MONTH_START[startMonth - 1] + DAYS) % DAYS;
}

/** Año en que empieza el período al que pertenece la fecha (abril 2026–marzo 2027 → 2026). */
export function periodYear(iso: string, startMonth = 1): number {
  const year = Number(iso.slice(0, 4));
  return Number(iso.slice(5, 7)) < startMonth ? year - 1 : year;
}

/** Cuantil de un arreglo ordenado, con interpolación lineal (el método por defecto de R y NumPy). */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

/**
 * En qué percentil cae `value` dentro de la distribución (0–100):
 * porcentaje de valores por debajo, contando la mitad de los empates.
 */
export function percentileRank(sorted: readonly number[], value: number): number {
  if (sorted.length === 0) return NaN;
  let below = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < value) below++;
    else if (v === value) equal++;
    else break;
  }
  return ((below + equal / 2) / sorted.length) * 100;
}

export interface Climatology {
  p10: number[];
  p50: number[];
  p90: number[];
  mean: number[];
  /** Distribución ordenada de cada posición, para calcular percentiles de días nuevos. */
  pools: number[][];
}

function summarize(pools: number[][]): Climatology {
  const c: Climatology = { p10: [], p50: [], p90: [], mean: [], pools };
  for (const pool of pools) {
    pool.sort((a, b) => a - b);
    c.p10.push(quantile(pool, 0.1));
    c.p50.push(quantile(pool, 0.5));
    c.p90.push(quantile(pool, 0.9));
    c.mean.push(pool.reduce((s, v) => s + v, 0) / pool.length);
  }
  return c;
}

interface BaseOptions {
  baseStart?: number;
  baseEnd?: number;
}

/**
 * Climatología de una variable diaria (temperatura). Para cada posición del año junta los
 * valores de los años base en una ventana de ±`halfWindow` días (unos 450 datos con ±7 y
 * 30 años) y calcula percentiles. La ventana da la vuelta: el 3 de enero usa días de fines
 * de diciembre.
 */
export function dailyClimatology(
  dates: readonly string[],
  values: readonly (number | null)[],
  { halfWindow = 7, baseStart = BASE_START, baseEnd = BASE_END }: BaseOptions & { halfWindow?: number } = {},
): Climatology {
  const pools: number[][] = Array.from({ length: DAYS }, () => []);
  for (let i = 0; i < dates.length; i++) {
    const v = values[i];
    const year = Number(dates[i].slice(0, 4));
    if (v == null || year < baseStart || year > baseEnd) continue;
    const d = doy365(dates[i]);
    for (let k = -halfWindow; k <= halfWindow; k++) {
      pools[(d + k + DAYS) % DAYS].push(v);
    }
  }
  return summarize(pools);
}

/**
 * Climatología de la precipitación acumulada. Arma la trayectoria acumulada de cada período
 * base (desde el día 1 de `startMonth`) y calcula los percentiles día a día sobre las 30
 * trayectorias. La lluvia del 29/2 se suma a la posición del 28/2. Un período base con
 * algún día sin dato se descarta entero, para no sesgar la acumulada hacia abajo.
 */
export function accumulationClimatology(
  dates: readonly string[],
  precip: readonly (number | null)[],
  { startMonth = 1, baseStart = BASE_START, baseEnd = BASE_END }: BaseOptions & { startMonth?: number } = {},
): Climatology & { years: number } {
  const trajectories = new Map<number, { acc: number; traj: number[]; days: number; complete: boolean }>();
  for (let i = 0; i < dates.length; i++) {
    const py = periodYear(dates[i], startMonth);
    if (py < baseStart || py > baseEnd) continue;
    let t = trajectories.get(py);
    if (!t) trajectories.set(py, (t = { acc: 0, traj: new Array(DAYS).fill(NaN), days: 0, complete: true }));
    const p = precip[i];
    if (p == null) t.complete = false;
    t.acc += p ?? 0;
    t.traj[periodIndex(dates[i], startMonth)] = t.acc;
    t.days++;
  }

  const pools: number[][] = Array.from({ length: DAYS }, () => []);
  let years = 0;
  for (const t of trajectories.values()) {
    if (!t.complete || t.days < DAYS) continue;
    years++;
    t.traj.forEach((v, idx) => pools[idx].push(v));
  }
  return { ...summarize(pools), years };
}
