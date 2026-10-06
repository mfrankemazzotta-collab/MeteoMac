import * as Plot from "@observablehq/plot";
import type { DayRow } from "../data/year";

/** Plot no entiende `var(--x)` como color, así que leemos los tokens CSS al dibujar. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const monthFmt = new Intl.DateTimeFormat("es-AR", { month: "short", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" });
const axisNum = (v: number) => v.toLocaleString("es-AR");
const num = (v: number | null, digits = 1) =>
  v == null ? "s/d" : v.toLocaleString("es-AR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

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
  rows: DayRow[];
  year: number;
  width: number;
}

function baseOptions({ year, width }: ChartOptions) {
  return {
    width,
    height: Math.round(Math.min(320, Math.max(220, width * 0.55))),
    marginLeft: 44,
    marginRight: 12,
    marginTop: 26,
    style: { fontSize: "12px", color: token("--text-secondary"), background: "transparent" },
    x: {
      type: "utc" as const,
      domain: [new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year, 11, 31))],
      ticks: width < 500 ? "3 months" : "month",
      tickFormat: (d: Date) => monthFmt.format(d).replace(".", ""),
      label: null,
    },
  };
}

/** Marcas comunes: línea consolidada, línea preliminar punteada y capa de hover. */
function lineMarks(rows: DayRow[], y: "temp" | "precipAcc", color: string, tipTitle: (r: DayRow) => string) {
  const { solid, dashed } = splitPreliminary(rows);
  const surface = token("--surface-1");
  return [
    Plot.lineY(solid, { x: "date", y, stroke: color, strokeWidth: 2 }),
    Plot.lineY(dashed, { x: "date", y, stroke: color, strokeWidth: 2, strokeDasharray: "4 3" }),
    Plot.ruleX(rows, Plot.pointerX({ x: "date", stroke: token("--text-muted"), strokeWidth: 1 })),
    Plot.dot(rows, Plot.pointerX({ x: "date", y, r: 4, fill: color, stroke: surface, strokeWidth: 2 })),
    Plot.tip(rows, Plot.pointerX({ x: "date", y, title: tipTitle, fontSize: 12 })),
  ];
}

const prelimNote = (r: DayRow) => (r.preliminary ? "\nDato preliminar (pronóstico)" : "");

export function temperatureChart(opts: ChartOptions) {
  const color = token("--series-temp");
  return Plot.plot({
    ...baseOptions(opts),
    y: { label: "°C", grid: true, nice: true, tickFormat: axisNum },
    marks: [
      Plot.ruleY([0], { stroke: token("--text-muted"), strokeOpacity: 0.5 }),
      ...lineMarks(opts.rows, "temp", color, (r) => `${dayFmt.format(r.date)}\nT media: ${num(r.temp)} °C${prelimNote(r)}`),
    ],
  });
}

export function precipitationChart(opts: ChartOptions) {
  const color = token("--series-precip");
  return Plot.plot({
    ...baseOptions(opts),
    y: { label: "mm", grid: true, nice: true, tickFormat: axisNum, domain: [0, Math.max(10, ...opts.rows.map((r) => r.precipAcc))] },
    marks: [
      Plot.ruleY([0], { stroke: token("--text-muted"), strokeOpacity: 0.5 }),
      ...lineMarks(
        opts.rows,
        "precipAcc",
        color,
        (r) => `${dayFmt.format(r.date)}\nAcumulada: ${num(r.precipAcc, 0)} mm\nDel día: ${num(r.precip)} mm${prelimNote(r)}`,
      ),
    ],
  });
}
