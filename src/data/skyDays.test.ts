import { describe, expect, it } from "vitest";
import { classifyDay, monthlySky, skyNormals, skyTotals } from "./skyDays";
import { addDays } from "./dates";
import type { DailySeries } from "./openmeteo";

function makeSeries(start: string, end: string, day: (d: string) => [number | null, number | null]): DailySeries {
  const s: DailySeries = { dates: [], temp: [], tmax: [], tmin: [], precip: [], cloud: [] };
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const [p, c] = day(d);
    s.dates.push(d);
    s.temp.push(10);
    s.tmax.push(15);
    s.tmin.push(5);
    s.precip.push(p);
    s.cloud.push(c);
  }
  return s;
}

const empty: DailySeries = { dates: [], temp: [], tmax: [], tmin: [], precip: [], cloud: [] };

describe("classifyDay", () => {
  it("la lluvia manda (≥ 1 mm), aunque el cielo haya estado despejado", () => {
    expect(classifyDay(1, 10)).toBe("rain");
    expect(classifyDay(0.9, 10)).toBe("clear");
  });

  it("clasifica por nubosidad media con umbrales de 25 % y 75 %", () => {
    expect(classifyDay(0, 25)).toBe("clear");
    expect(classifyDay(0, 26)).toBe("partly");
    expect(classifyDay(0, 74)).toBe("partly");
    expect(classifyDay(0, 75)).toBe("cloudy");
  });

  it("sin dato devuelve null (salvo que ya se sepa que llovió)", () => {
    expect(classifyDay(0, null)).toBe(null);
    expect(classifyDay(null, 10)).toBe(null);
    expect(classifyDay(5, null)).toBe("rain");
  });
});

describe("monthlySky", () => {
  // Base 1991–2020: los días 1–10 de cada mes llueve, 11–20 nublado, resto despejado.
  // 2026 hasta el 15 de marzo: todo despejado.
  const archive = makeSeries("1991-01-01", "2026-03-15", (d) => {
    if (d >= "2026-01-01") return [0, 0];
    const day = Number(d.slice(8, 10));
    return day <= 10 ? [5, 90] : day <= 20 ? [0, 90] : [0, 0];
  });
  const normals = skyNormals(archive);
  const months = monthlySky({ archive, preliminary: empty }, normals, 2026);

  it("devuelve los 12 meses del período, en orden", () => {
    expect(months.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(months[0].counts).toEqual({ rain: 0, cloudy: 0, partly: 0, clear: 31 });
  });

  it("la normal se ajusta a los días observados del mes en curso", () => {
    const march = months[2];
    expect(march.days).toBe(15);
    // En marzo base: 10 de 31 días con lluvia → 15 días × 10/31.
    expect(march.normal.rain).toBeCloseTo((15 * 10) / 31);
    expect(months[3].days).toBe(0);
    expect(months[3].normal.rain).toBe(0);
  });

  it("totales: observado vs. normal para los mismos días", () => {
    const t = skyTotals(months);
    expect(t.days).toBe(31 + 28 + 15);
    expect(t.counts.clear).toBe(74);
    expect(t.normal.rain).toBeCloseTo(10 + 10 * (28 / 28.25) + (15 * 10) / 31, 0);
  });

  it("año hidrológico: arranca en abril y enero cae en el período anterior", () => {
    const hydro = monthlySky({ archive, preliminary: empty }, normals, 2025, 4);
    expect(hydro[0].month).toBe(4);
    expect(hydro[9]).toMatchObject({ month: 1, days: 31 });
  });

  it("cuenta los días preliminares aparte", () => {
    const prelim = makeSeries("2026-03-16", "2026-03-17", () => [3, 50]);
    const withPrelim = monthlySky({ archive, preliminary: prelim }, normals, 2026);
    expect(withPrelim[2]).toMatchObject({ days: 17, preliminaryDays: 2 });
    expect(withPrelim[2].counts.rain).toBe(2);
  });
});
