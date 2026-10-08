import { describe, expect, it } from "vitest";
import { dailyAnomalies, referenceDate, symmetricLimit, yearlyAnomalies } from "./anomalies";
import { dailyClimatology } from "./climatology";
import { addDays } from "./dates";
import type { DailySeries } from "./openmeteo";

function makeSeries(start: string, end: string, tmax: (d: string) => number | null): DailySeries {
  const s: DailySeries = { dates: [], temp: [], tmax: [], tmin: [], precip: [] };
  for (let d = start; d <= end; d = addDays(d, 1)) {
    s.dates.push(d);
    s.temp.push(10);
    s.tmax.push(tmax(d));
    s.tmin.push(0);
    s.precip.push(1);
  }
  return s;
}

const empty: DailySeries = { dates: [], temp: [], tmax: [], tmin: [], precip: [] };

// Base: máxima de 20 °C. 2025: 22 °C (+2). 2026 hasta marzo: 17 °C (−3), con un día sin dato.
const archive = makeSeries("1991-01-01", "2026-03-31", (d) =>
  d === "2026-02-10" ? null : d >= "2026-01-01" ? 17 : d >= "2025-01-01" ? 22 : 20,
);
const clim = dailyClimatology(archive.dates, archive.tmax);

describe("dailyAnomalies", () => {
  const days = dailyAnomalies({ archive, preliminary: empty }, clim, "max");

  it("resta el promedio climatológico del día a la variable elegida", () => {
    expect(days.find((d) => d.iso === "2025-07-01")?.anomaly).toBeCloseTo(2);
    expect(days.find((d) => d.iso === "2000-07-01")?.anomaly).toBeCloseTo(0);
  });

  it("omite los días sin dato", () => {
    expect(days.find((d) => d.iso === "2026-02-10")).toBeUndefined();
  });

  it("marca los días preliminares", () => {
    const prelim = makeSeries("2026-04-01", "2026-04-02", () => 20);
    const all = dailyAnomalies({ archive, preliminary: prelim }, clim, "max");
    expect(all.at(-1)).toMatchObject({ iso: "2026-04-02", preliminary: true });
  });

  it("año hidrológico: enero–marzo pertenecen al período del año anterior", () => {
    const hydro = dailyAnomalies({ archive, preliminary: empty }, clim, "max", 4);
    expect(hydro.find((d) => d.iso === "2026-01-15")).toMatchObject({ year: 2025, index: 289 });
  });
});

describe("yearlyAnomalies", () => {
  const years = yearlyAnomalies(dailyAnomalies({ archive, preliminary: empty }, clim, "max"));

  it("una anomalía por año, ordenada", () => {
    expect(years[0].year).toBe(1991);
    expect(years.at(-1)?.year).toBe(2026);
    expect(years).toHaveLength(36);
  });

  it("promedia las anomalías diarias y marca el año en curso como incompleto", () => {
    expect(years.find((y) => y.year === 2025)).toMatchObject({ complete: true, days: 365 });
    expect(years.find((y) => y.year === 2025)?.anomaly).toBeCloseTo(2);
    const partial = years.find((y) => y.year === 2026)!;
    expect(partial.complete).toBe(false);
    expect(partial.days).toBe(89);
    expect(partial.anomaly).toBeCloseTo(-3);
  });
});

describe("symmetricLimit", () => {
  it("usa el percentil del valor absoluto, redondeado hacia arriba", () => {
    const values = Array.from({ length: 100 }, (_, i) => (i % 2 ? 1 : -1) * (i / 10));
    expect(symmetricLimit(values, 0.98)).toBe(10);
    expect(symmetricLimit([0.2, -0.3], 1, 0.5)).toBe(0.5);
    expect(symmetricLimit([])).toBe(1);
  });
});

describe("referenceDate", () => {
  it("ubica todos los años en un calendario bisiesto común", () => {
    expect(referenceDate("2023-03-01").toISOString().slice(0, 10)).toBe("2000-03-01");
    expect(referenceDate("2024-02-29").toISOString().slice(0, 10)).toBe("2000-02-29");
  });

  it("año hidrológico: abril–diciembre en 1999 y enero–marzo en 2000", () => {
    expect(referenceDate("2025-04-01", 4).toISOString().slice(0, 10)).toBe("1999-04-01");
    expect(referenceDate("2028-02-29", 4).toISOString().slice(0, 10)).toBe("2000-02-29");
  });
});
