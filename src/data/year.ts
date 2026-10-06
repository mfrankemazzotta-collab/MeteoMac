import type { PointData } from "./openmeteo";

export interface DayRow {
  /** Fecha como Date en UTC (medianoche), para el eje temporal. */
  date: Date;
  iso: string;
  temp: number | null;
  precip: number | null;
  /** Precipitación acumulada desde el 1 de enero (mm). */
  precipAcc: number;
  preliminary: boolean;
}

/**
 * Días del año `year` (reanálisis + preliminares), con la precipitación acumulada.
 * Un día sin dato de lluvia suma 0 a la acumulada (no debería pasar en el reanálisis).
 */
export function yearRows(data: PointData, year: number): DayRow[] {
  const prefix = `${year}-`;
  const rows: DayRow[] = [];
  let acc = 0;
  const push = (iso: string, temp: number | null, precip: number | null, preliminary: boolean) => {
    if (!iso.startsWith(prefix)) return;
    acc += precip ?? 0;
    rows.push({ date: new Date(iso + "T00:00:00Z"), iso, temp, precip, precipAcc: acc, preliminary });
  };
  const { archive, preliminary } = data;
  archive.dates.forEach((d, i) => push(d, archive.temp[i], archive.precip[i], false));
  preliminary.dates.forEach((d, i) => push(d, preliminary.temp[i], preliminary.precip[i], true));
  return rows;
}
