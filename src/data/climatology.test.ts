import { describe, expect, it } from "vitest";
import {
  accumulationClimatology,
  dailyClimatology,
  doy365,
  percentileRank,
  periodIndex,
  periodYear,
  quantile,
} from "./climatology";
import { addDays } from "./dates";

/** Serie diaria sintética entre dos fechas (inclusive). */
function series(start: string, end: string, value: (iso: string) => number | null) {
  const dates: string[] = [];
  const values: (number | null)[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    dates.push(d);
    values.push(value(d));
  }
  return { dates, values };
}

const year = (iso: string) => Number(iso.slice(0, 4));

describe("doy365", () => {
  it("numera de 0 a 364", () => {
    expect(doy365("2025-01-01")).toBe(0);
    expect(doy365("2025-12-31")).toBe(364);
    expect(doy365("2024-12-31")).toBe(364);
  });

  it("pone el 29/2 en la misma posición que el 28/2 y no corre marzo", () => {
    expect(doy365("2024-02-28")).toBe(58);
    expect(doy365("2024-02-29")).toBe(58);
    expect(doy365("2024-03-01")).toBe(59);
    expect(doy365("2025-03-01")).toBe(59);
  });
});

describe("año hidrológico (abril–marzo)", () => {
  it("periodIndex arranca el 1 de abril", () => {
    expect(periodIndex("2025-04-01", 4)).toBe(0);
    expect(periodIndex("2026-03-31", 4)).toBe(364);
    expect(periodIndex("2026-01-01", 4)).toBe(275);
  });

  it("periodYear asigna enero–marzo al período que empezó el año anterior", () => {
    expect(periodYear("2026-03-31", 4)).toBe(2025);
    expect(periodYear("2026-04-01", 4)).toBe(2026);
    expect(periodYear("2026-03-31", 1)).toBe(2026);
  });
});

describe("quantile", () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  it("interpola linealmente como NumPy/R tipo 7", () => {
    expect(quantile(xs, 0.5)).toBeCloseTo(5.5);
    expect(quantile(xs, 0.1)).toBeCloseTo(1.9);
    expect(quantile(xs, 0.9)).toBeCloseTo(9.1);
    expect(quantile(xs, 0)).toBe(1);
    expect(quantile(xs, 1)).toBe(10);
  });

  it("maneja un solo valor y el arreglo vacío", () => {
    expect(quantile([7], 0.9)).toBe(7);
    expect(quantile([], 0.5)).toBeNaN();
  });
});

describe("percentileRank", () => {
  const xs = [1, 2, 3, 4];
  it("cuenta los valores por debajo y la mitad de los empates", () => {
    expect(percentileRank(xs, 2.5)).toBe(50);
    expect(percentileRank(xs, 2)).toBe(37.5);
    expect(percentileRank(xs, 0)).toBe(0);
    expect(percentileRank(xs, 99)).toBe(100);
  });
});

describe("dailyClimatology", () => {
  it("junta ±7 días de los 30 años: 450 valores por día", () => {
    const { dates, values } = series("1991-01-01", "2020-12-31", year);
    const c = dailyClimatology(dates, values);
    expect(c.pools[200]).toHaveLength(450);
    expect(c.p50[200]).toBeCloseTo(2005.5);
    expect(c.mean[200]).toBeCloseTo(2005.5);
    expect(c.p10[200]).toBeLessThan(c.p50[200]);
    expect(c.p90[200]).toBeGreaterThan(c.p50[200]);
  });

  it("suma los 29/2 de los 8 años bisiestos sin romper el cálculo", () => {
    const { dates, values } = series("1991-01-01", "2020-12-31", () => 1);
    const c = dailyClimatology(dates, values);
    expect(c.pools[58]).toHaveLength(458);
    expect(c.pools[150]).toHaveLength(450);
    expect(c.p50.every(Number.isFinite)).toBe(true);
  });

  it("la ventana da la vuelta al año: el 1 de enero usa días de diciembre", () => {
    const { dates, values } = series("1991-01-01", "2020-12-31", (d) => (d.slice(5, 7) === "12" ? 1 : 0));
    const c = dailyClimatology(dates, values);
    expect(c.pools[0].filter((v) => v === 1)).toHaveLength(7 * 30);
  });

  it("ignora los años fuera de 1991–2020 y los días sin dato", () => {
    const { dates, values } = series("1990-01-01", "2021-12-31", (d) => {
      const y = year(d);
      if (y === 1990 || y === 2021) return 1000;
      return d === "2000-07-01" ? null : 5;
    });
    const c = dailyClimatology(dates, values);
    expect(c.p90[100]).toBe(5);
    expect(c.pools[181]).toHaveLength(449);
  });
});

describe("accumulationClimatology", () => {
  it("acumula cada año y saca percentiles sobre las trayectorias", () => {
    const { dates, values } = series("1991-01-01", "2020-12-31", () => 1);
    const c = accumulationClimatology(dates, values);
    expect(c.years).toBe(30);
    expect(c.pools[0]).toEqual(new Array(30).fill(1));
    // A fin de año: 22 años de 365 mm y 8 bisiestos de 366 mm.
    expect(c.pools[364].filter((v) => v === 365)).toHaveLength(22);
    expect(c.pools[364].filter((v) => v === 366)).toHaveLength(8);
    expect(c.p50[364]).toBe(365);
  });

  it("la lluvia del 29/2 se suma en la posición del 28/2", () => {
    const { dates, values } = series("1991-01-01", "2020-12-31", (d) => (d.endsWith("-02-29") ? 50 : 0));
    const c = accumulationClimatology(dates, values);
    expect(c.pools[57].every((v) => v === 0)).toBe(true);
    expect(c.pools[58].filter((v) => v === 50)).toHaveLength(8);
  });

  it("descarta un año base con días sin dato", () => {
    const { dates, values } = series("1991-01-01", "2020-12-31", (d) => (d === "1995-06-01" ? null : 1));
    expect(accumulationClimatology(dates, values).years).toBe(29);
  });

  it("año hidrológico: 30 períodos de abril 1991 a marzo 2021", () => {
    const full = series("1991-01-01", "2021-03-31", () => 1);
    const c = accumulationClimatology(full.dates, full.values, { startMonth: 4 });
    expect(c.years).toBe(30);
    expect(c.p50[0]).toBe(1);
    const short = series("1991-01-01", "2020-12-31", () => 1);
    expect(accumulationClimatology(short.dates, short.values, { startMonth: 4 }).years).toBe(29);
  });
});
