import { describe, expect, it } from "vitest";
import { analyzeYear, buildClimatology, periodDates } from "./analysis";
import { addDays } from "./dates";
import type { DailySeries } from "./openmeteo";

function makeSeries(start: string, end: string, temp: (d: string) => number, precip: (d: string) => number): DailySeries {
  const s: DailySeries = { dates: [], temp: [], tmax: [], tmin: [], precip: [] };
  for (let d = start; d <= end; d = addDays(d, 1)) {
    s.dates.push(d);
    s.temp.push(temp(d));
    s.tmax.push(temp(d) + 5);
    s.tmin.push(temp(d) - 5);
    s.precip.push(precip(d));
  }
  return s;
}

const is2026 = (d: string) => d >= "2026-01-01";

// Base: 10 °C y 1 mm por día. 2026: 20 °C y 2 mm por día.
const archive = makeSeries(
  "1991-01-01",
  "2026-09-28",
  (d) => (is2026(d) ? 20 : 10),
  (d) => (is2026(d) ? 2 : 1),
);
const preliminary = makeSeries("2026-09-29", "2026-10-05", () => 20, () => 2);

describe("periodDates", () => {
  it("devuelve 365 o 366 días según el año", () => {
    expect(periodDates(2025)).toHaveLength(365);
    expect(periodDates(2024)).toHaveLength(366);
    expect(periodDates(2025, 4)[0]).toBe("2025-04-01");
    expect(periodDates(2025, 4).at(-1)).toBe("2026-03-31");
  });
});

describe("analyzeYear", () => {
  const clim = buildClimatology(archive);
  const a = analyzeYear({ archive, preliminary }, clim, 2026);

  it("incluye los días del reanálisis y los preliminares, marcados", () => {
    expect(a.rows[0].iso).toBe("2026-01-01");
    expect(a.rows.at(-1)?.iso).toBe("2026-10-05");
    expect(a.summary.preliminaryDays).toBe(7);
    expect(a.rows.at(-1)?.preliminary).toBe(true);
  });

  it("la banda cubre todo el año aunque falten días por venir", () => {
    expect(a.band).toHaveLength(365);
    expect(a.band[100].t50).toBe(10);
  });

  it("marca los días fuera de la banda y su percentil", () => {
    expect(a.rows[0].tempOutside).toBe("above");
    expect(a.rows[0].tempPct).toBe(100);
  });

  it("resume la lluvia como % de la mediana y la anomalía de temperatura", () => {
    expect(a.summary.tempAnomaly).toBeCloseTo(10);
    expect(a.summary.rainPctOfMedian).toBeCloseTo(200, 0);
  });

  it("año hidrológico: la acumulada arranca de cero el 1 de abril", () => {
    const hydro = analyzeYear({ archive, preliminary }, buildClimatology(archive, 4), 2025);
    expect(hydro.rows[0].iso).toBe("2025-04-01");
    expect(hydro.rows[0].precipAcc).toBe(1);
    expect(hydro.band).toHaveLength(365);
    expect(hydro.periodEnd).toBe("2026-03-31");
  });

  it("un año bisiesto tiene su 29/2 con banda", () => {
    const leap = analyzeYear({ archive, preliminary }, clim, 2024);
    const feb29 = leap.band.find((b) => b.iso === "2024-02-29");
    expect(leap.band).toHaveLength(366);
    expect(feb29?.t50).toBe(10);
    expect(leap.rows.find((r) => r.iso === "2024-02-29")?.tempOutside).toBe(null);
  });
});
