// Franjas de calentamiento ("warming stripes") y calendario de anomalías diarias.

import * as Plot from "@observablehq/plot";
import { referenceDate, symmetricLimit, type DayAnomaly, type YearAnomaly } from "../data/anomalies";
import { num } from "./charts";

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const monthFmt = new Intl.DateTimeFormat("es-AR", { month: "short", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${num(Math.abs(v))} °C`;

/**
 * Escala divergente azul ↔ gris ↔ rojo, simétrica alrededor de 0 y con los extremos
 * recortados en ±limit. Los colores salen de los tokens CSS, así respeta el tema.
 */
function divergingColor(limit: number) {
  return {
    type: "linear" as const,
    domain: [-limit, -limit / 2, 0, limit / 2, limit],
    range: ["--div-cold-2", "--div-cold-1", "--div-neutral", "--div-warm-1", "--div-warm-2"].map(token),
    clamp: true,
    label: "Anomalía (°C)",
    tickFormat: (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : "0"),
  };
}

/** Leyenda de color (rampa) para poner arriba de cada gráfico. */
export function colorLegend(limit: number, width: number) {
  return Plot.legend({
    color: divergingColor(limit),
    width: Math.min(320, width),
    ticks: 5,
    style: { color: token("--text-secondary"), background: "transparent" },
  });
}

interface StripesOptions {
  years: YearAnomaly[];
  width: number;
  label: (year: number) => string;
}

export function stripesLimit(years: YearAnomaly[]) {
  return symmetricLimit(
    years.map((y) => y.anomaly),
    1,
    0.5,
  );
}

/** Una franja por año, pintada según su anomalía. Como la imagen clásica de Ed Hawkins. */
export function stripesChart({ years, width, label }: StripesOptions) {
  const limit = stripesLimit(years);
  const step = width < 500 ? 10 : 5;
  const partial = years.filter((y) => !y.complete);
  return Plot.plot({
    width,
    height: width < 500 ? 120 : 150,
    marginLeft: 8,
    marginRight: 8,
    marginBottom: 26,
    style: { fontSize: "12px", color: token("--text-secondary"), background: "transparent" },
    x: {
      type: "band",
      domain: years.map((y) => y.year),
      padding: 0,
      tickFormat: (y: number) => (y % step === 0 ? String(y) : ""),
      tickSize: 0,
      label: null,
    },
    color: divergingColor(limit),
    marks: [
      Plot.cell(years, { x: "year", fill: "anomaly", shapeRendering: "crispEdges" }),
      // El año en curso está incompleto: lo marcamos con un borde punteado (y lo dice el tooltip).
      Plot.cell(partial, { x: "year", fill: "none", stroke: token("--text-primary"), strokeDasharray: "2 2", inset: 1 }),
      Plot.tip(
        years,
        Plot.pointerX({
          x: "year",
          frameAnchor: "middle",
          fontSize: 12,
          title: (y: YearAnomaly) =>
            `${label(y.year)}: ${signed(y.anomaly)} vs. 1991–2020` + (y.complete ? "" : `\nIncompleto (${y.days} días)`),
        }),
      ),
    ],
  });
}

interface CalendarOptions {
  days: DayAnomaly[];
  width: number;
  startMonth: number;
  label: (year: number) => string;
  variableLabel: string;
}

export function calendarLimit(days: DayAnomaly[]) {
  return symmetricLimit(days.map((d) => d.anomaly), 0.98, 1);
}

/** Calendario: una fila por año, una columna por día; el color es la anomalía de ese día. */
export function calendarChart({ days, width, startMonth, label, variableLabel }: CalendarOptions) {
  const limit = calendarLimit(days);
  const years = [...new Set(days.map((d) => d.year))].sort((a, b) => b - a);
  const rowHeight = width < 500 ? 7 : 9;
  const DAY = 86_400_000;
  const cells = days.map((d) => {
    const x1 = referenceDate(d.iso, startMonth);
    // En años no bisiestos el 28/2 ocupa también el lugar del 29, para no dejar una columna vacía.
    const year = Number(d.iso.slice(0, 4));
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const span = d.iso.endsWith("-02-28") && !leap ? 2 : 1;
    return { ...d, x1, x2: new Date(x1.getTime() + span * DAY), xm: new Date(x1.getTime() + DAY / 2) };
  });
  const first = referenceDate(startMonth === 1 ? "2000-01-01" : `2000-${String(startMonth).padStart(2, "0")}-01`, startMonth);
  const last = new Date(Date.UTC(first.getUTCFullYear() + 1, first.getUTCMonth(), 1));
  return Plot.plot({
    width,
    height: years.length * rowHeight + 46,
    marginLeft: width < 500 ? 40 : 52,
    marginRight: 8,
    marginTop: 8,
    style: { fontSize: "11px", color: token("--text-secondary"), background: "transparent" },
    x: {
      type: "utc",
      domain: [first, last],
      ticks: width < 500 ? "3 months" : "month",
      tickFormat: (d: Date) => monthFmt.format(d).replace(".", ""),
      label: null,
    },
    y: {
      type: "band",
      domain: years,
      padding: 0,
      tickFormat: (y: number) => (y % (width < 500 ? 5 : 2) === 0 ? label(y) : ""),
      tickSize: 0,
      label: null,
    },
    color: divergingColor(limit),
    marks: [
      Plot.barX(cells, { x1: "x1", x2: "x2", y: "year", fill: "anomaly", inset: 0, shapeRendering: "crispEdges" }),
      Plot.tip(
        cells,
        Plot.pointer({
          x: "xm",
          y: "year",
          fontSize: 12,
          title: (d: (typeof cells)[number]) =>
            `${dayFmt.format(new Date(d.iso + "T00:00:00Z"))}\nT ${variableLabel}: ${num(d.value)} °C` +
            `\nAnomalía: ${signed(d.anomaly)}` +
            (d.preliminary ? "\nDato preliminar (pronóstico)" : ""),
        }),
      ),
    ],
  });
}
