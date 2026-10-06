import * as Plot from "@observablehq/plot";
import type { DayRow, YearAnalysis } from "../data/analysis";

/** Plot no entiende `var(--x)` como color, así que leemos los tokens CSS al dibujar. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const monthFmt = new Intl.DateTimeFormat("es-AR", { month: "short", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" });
const axisNum = (v: number) => v.toLocaleString("es-AR");
export const num = (v: number | null, digits = 1) =>
  v == null || !Number.isFinite(v)
    ? "s/d"
    : v.toLocaleString("es-AR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (v: number | null) => (v == null ? "s/d" : `p${Math.round(v)}`);

/**
 * Parte la serie en el tramo consolidado y el preliminar. El tramo preliminar arranca en el
 * último día consolidado para que las dos líneas queden unidas.
 */
function splitPreliminary(rows: DayRow[]) {
  const firstPrelim = rows.findIndex((r) => r.preliminary);
  if (firstPrelim < 0) return { solid: rows, dashed: [] };
  return { solid: rows.slice(0, firstPrelim), dashed: rows.slice(Math.max(0, firstPrelim - 1)) };
}

interface ChartOptions {
  analysis: YearAnalysis;
  width: number;
  /** Otro modelo para superponer (solo temperatura: la lluvia es la misma en ambos). */
  compare?: YearAnalysis;
  compareLabel?: string;
}

function baseOptions({ analysis, width }: ChartOptions) {
  const first = analysis.band[0].date;
  const last = analysis.band[analysis.band.length - 1].date;
  return {
    width,
    height: Math.round(Math.min(340, Math.max(240, width * 0.58))),
    marginLeft: 44,
    marginRight: 12,
    marginTop: 26,
    style: { fontSize: "12px", color: token("--text-secondary"), background: "transparent" },
    x: {
      type: "utc" as const,
      domain: [first, last],
      ticks: width < 500 ? "3 months" : "month",
      tickFormat: (d: Date) => monthFmt.format(d).replace(".", ""),
      label: null,
    },
  };
}

/** Línea del año (consolidada + preliminar punteada) y capa de hover. */
function yearLine(
  rows: DayRow[],
  y: "temp" | "precipAcc",
  color: string,
  width: number,
  tipTitle: (r: DayRow) => string,
) {
  const { solid, dashed } = splitPreliminary(rows);
  return [
    Plot.lineY(solid, { x: "date", y, stroke: color, strokeWidth: width }),
    Plot.lineY(dashed, { x: "date", y, stroke: color, strokeWidth: width, strokeDasharray: "4 3" }),
    Plot.ruleX(rows, Plot.pointerX({ x: "date", stroke: token("--text-muted"), strokeWidth: 1 })),
    Plot.dot(rows, Plot.pointerX({ x: "date", y, r: 4, fill: color, stroke: token("--surface-1"), strokeWidth: 2 })),
    Plot.tip(rows, Plot.pointerX({ x: "date", y, title: tipTitle, fontSize: 12, lineWidth: 40 })),
  ];
}

const prelimNote = (r: DayRow) => (r.preliminary ? "\nDato preliminar (pronóstico)" : "");

export function temperatureChart(opts: ChartOptions) {
  const { rows, band } = opts.analysis;
  const bandByIso = new Map(band.map((b) => [b.iso, b]));
  const above = rows.filter((r) => r.tempOutside === "above");
  const below = rows.filter((r) => r.tempOutside === "below");
  const surface = token("--surface-1");
  // En el celular hay poco lugar: triángulos más chicos para que no tapen la línea.
  const r = opts.width < 500 ? 2.5 : 3.5;
  const compare = opts.compare;
  const compareColor = token("--series-compare");
  const compareByIso = compare && new Map(compare.rows.map((c) => [c.iso, c]));
  return Plot.plot({
    ...baseOptions(opts),
    y: { label: "°C", grid: true, nice: true, tickFormat: axisNum },
    marks: [
      Plot.areaY(band, { x: "date", y1: "t10", y2: "t90", fill: token("--band-temp"), curve: "monotone-x" }),
      Plot.ruleY([0], { stroke: token("--text-muted"), strokeOpacity: 0.5 }),
      Plot.lineY(band, { x: "date", y: "t50", stroke: token("--text-muted"), strokeWidth: 1.5, curve: "monotone-x" }),
      ...(compare
        ? [
            Plot.lineY(compare.band, { x: "date", y: "t50", stroke: compareColor, strokeWidth: 1.25, strokeDasharray: "2 3", curve: "monotone-x" }),
            Plot.lineY(compare.rows, { x: "date", y: "temp", stroke: compareColor, strokeWidth: 1.25, strokeOpacity: 0.9 }),
          ]
        : []),
      ...yearLine(rows, "temp", token("--series-line"), 1.25, (r) => {
        const b = bandByIso.get(r.iso);
        const where = r.tempOutside === "above" ? " ▲ más cálido que el p90" : r.tempOutside === "below" ? " ▼ más frío que el p10" : "";
        const c = compareByIso?.get(r.iso);
        const other = c && !r.preliminary ? `\n${opts.compareLabel}: ${num(c.temp)} °C (${pct(c.tempPct)})` : "";
        return (
          `${dayFmt.format(r.date)}\nT media: ${num(r.temp)} °C (${pct(r.tempPct)})${where}` +
          `\nNormal: ${num(b?.t50 ?? null)} °C (p10–p90: ${num(b?.t10 ?? null)} a ${num(b?.t90 ?? null)})${other}${prelimNote(r)}`
        );
      }),
      // Días fuera de la banda: color + forma (▲ arriba, ▼ abajo), para no depender solo del color.
      Plot.dot(above, { x: "date", y: "temp", symbol: "triangle", r, fill: token("--warm"), stroke: surface, strokeWidth: 0.75 }),
      Plot.dot(below, { x: "date", y: "temp", symbol: "triangle", rotate: 180, r, fill: token("--cool"), stroke: surface, strokeWidth: 0.75 }),
    ],
  });
}

export function precipitationChart(opts: ChartOptions) {
  const { rows, band } = opts.analysis;
  const bandByIso = new Map(band.map((b) => [b.iso, b]));
  const top = Math.max(10, ...band.map((b) => b.p90), ...rows.map((r) => r.precipAcc));
  return Plot.plot({
    ...baseOptions(opts),
    y: { label: "mm", grid: true, nice: true, tickFormat: axisNum, domain: [0, top] },
    marks: [
      Plot.areaY(band, { x: "date", y1: "p10", y2: "p90", fill: token("--band-precip") }),
      Plot.ruleY([0], { stroke: token("--text-muted"), strokeOpacity: 0.5 }),
      Plot.lineY(band, { x: "date", y: "p50", stroke: token("--text-muted"), strokeWidth: 1.5 }),
      ...yearLine(rows, "precipAcc", token("--series-precip"), 2, (r) => {
        const b = bandByIso.get(r.iso);
        const ofMedian = b && b.p50 > 0 ? ` (${num((r.precipAcc / b.p50) * 100, 0)} % de la mediana)` : "";
        return (
          `${dayFmt.format(r.date)}\nAcumulada: ${num(r.precipAcc, 0)} mm${ofMedian}, ${pct(r.precipAccPct)}` +
          `\nMediana: ${num(b?.p50 ?? null, 0)} mm (p10–p90: ${num(b?.p10 ?? null, 0)} a ${num(b?.p90 ?? null, 0)})` +
          `\nDel día: ${num(r.precip)} mm${prelimNote(r)}`
        );
      }),
    ],
  });
}
