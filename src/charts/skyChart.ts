// Días con lluvia / nublados / parciales / despejados, mes a mes, contra la normal 1991–2020.

import * as Plot from "@observablehq/plot";
import { SKY_CATEGORIES, SKY_INFO, type MonthSky, type SkyCategory } from "../data/skyDays";
import { num } from "./charts";

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export const skyColorVar: Record<SkyCategory, string> = {
  rain: "--sky-rain",
  cloudy: "--sky-cloudy",
  partly: "--sky-partly",
  clear: "--sky-clear",
};

/** Texto sobre cada segmento: claro sobre los colores oscuros, oscuro sobre los claros. */
const textOn: Record<SkyCategory, string> = {
  rain: "--sky-on-dark",
  cloudy: "--sky-on-dark",
  partly: "--sky-on-light",
  clear: "--sky-on-light",
};

interface Options {
  months: MonthSky[];
  width: number;
}

export function skyChart({ months, width }: Options) {
  const rows = months.flatMap((m) =>
    SKY_CATEGORIES.map((c) => ({ order: m.order, month: m.month, category: c, n: m.counts[c] })),
  );
  const ink = token("--text-primary");
  const maxDays = Math.max(...months.map((m) => m.daysInMonth));
  return Plot.plot({
    width,
    height: Math.round(Math.min(320, Math.max(240, width * 0.5))),
    marginLeft: 36,
    marginRight: 8,
    marginTop: 22,
    style: { fontSize: "12px", color: token("--text-secondary"), background: "transparent" },
    x: {
      type: "band",
      domain: months.map((m) => m.order),
      tickFormat: (o: number) => MONTHS[months[o].month - 1],
      padding: 0.18,
      label: null,
    },
    y: { label: "días", domain: [0, maxDays], ticks: [0, 10, 20, 30], grid: true },
    color: {
      domain: SKY_CATEGORIES,
      range: SKY_CATEGORIES.map((c) => token(skyColorVar[c])),
    },
    marks: [
      // 1 px del color de fondo entre segmentos, para que se distingan aunque los colores se parezcan.
      Plot.barY(rows, Plot.stackY({ x: "order", y: "n", fill: "category", order: SKY_CATEGORIES, stroke: token("--surface-1"), strokeWidth: 1 })),
      // Normal 1991–2020 de días con lluvia: una raya horizontal sobre cada barra (debajo de los números).
      Plot.tickY(
        months.filter((m) => m.days > 0),
        { x: "order", y: (m: MonthSky) => m.normal.rain, stroke: ink, strokeWidth: 2.5, inset: -2 },
      ),
      // Números dentro de los segmentos con lugar suficiente (etiquetas directas, no solo color).
      Plot.text(
        rows,
        Plot.stackY({
          x: "order",
          y: "n",
          order: SKY_CATEGORIES,
          text: (d: (typeof rows)[number]) => (d.n >= (width < 500 ? 4 : 3) ? String(d.n) : ""),
          fill: (d: (typeof rows)[number]) => token(textOn[d.category]),
          fontSize: width < 500 ? 9 : 11,
        }),
      ),
      Plot.tip(
        months,
        Plot.pointerX({
          x: "order",
          y: (m: MonthSky) => m.days,
          fontSize: 12,
          lineWidth: 40,
          title: (m: MonthSky) => {
            if (m.days === 0) return `${MONTHS[m.month - 1]}: sin datos todavía`;
            const head = `${MONTHS[m.month - 1]}${m.days < m.daysInMonth ? ` (${m.days} de ${m.daysInMonth} días)` : ""}`;
            const lines = SKY_CATEGORIES.map(
              (c) => `${SKY_INFO[c].label}: ${m.counts[c]} (normal ${num(m.normal[c], 1)})`,
            );
            const prelim = m.preliminaryDays ? `\nIncluye ${m.preliminaryDays} días preliminares (pronóstico)` : "";
            return `${head}\n${lines.join("\n")}${prelim}`;
          },
        }),
      ),
    ],
  });
}
