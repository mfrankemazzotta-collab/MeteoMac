import "./style.css";
import { fetchPointData, MODEL_INFO, type Model, type PointData } from "./data/openmeteo";
import { analyzeYear, buildClimatology, type Summary, type YearAnalysis } from "./data/analysis";
import { num, precipitationChart, temperatureChart } from "./charts/charts";

// Ubicación, modelo y año fijos hasta la fase 3, donde pasan a ser controles y parámetros de la URL.
const PLACE = { name: "Bariloche", lat: -41.1082, lon: -71.4341 };
const MODEL: Model = "era5_land";
const START_MONTH = 1;

const $ = (id: string) => document.getElementById(id)!;
const dateFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtDate = (iso: string, f = dateFmt) => f.format(new Date(iso + "T00:00:00Z"));

function renderCharts(analysis: YearAnalysis) {
  for (const [id, chart] of [
    ["chart-temp", temperatureChart],
    ["chart-precip", precipitationChart],
  ] as const) {
    const el = $(id);
    el.replaceChildren(chart({ analysis, width: el.clientWidth }));
  }
}

/** Resumen de una línea. Los signos y flechas acompañan al número para no depender del color. */
function renderSummary(s: Summary) {
  const el = $("summary");
  const parts: string[] = [];
  if (s.rainPctOfMedian != null) {
    parts.push(
      `Lluvia: <strong>${num(s.rainPctOfMedian, 0)} %</strong> de la mediana a la fecha ` +
        `<span class="detail">(${num(s.rainAcc, 0)} mm vs. ${num(s.rainMedian, 0)} mm)</span>`,
    );
  }
  if (s.tempAnomaly != null) {
    const sign = s.tempAnomaly > 0 ? "+" : s.tempAnomaly < 0 ? "−" : "";
    const word = s.tempAnomaly >= 0 ? "más cálido" : "más frío";
    parts.push(`Temperatura: <strong>${sign}${num(Math.abs(s.tempAnomaly))} °C</strong> ${word} que 1991–2020`);
  }
  el.innerHTML = parts.join('<span class="sep" aria-hidden="true">·</span> ') + ` <span class="detail">(al ${fmtDate(s.lastDate, shortFmt)})</span>`;
  el.hidden = parts.length === 0;
}

function renderSource(data: PointData, years: number) {
  const t = MODEL_INFO[data.model];
  const p = MODEL_INFO[data.precipModel];
  const precipNote =
    data.precipModel !== data.model
      ? ` La precipitación sale de ${p.label} (${p.resolution}) porque Open-Meteo no publica lluvia para ${t.label}.`
      : "";
  $("source").innerHTML = `
    <p>Datos: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>.
    Temperatura: reanálisis ${t.label} (${t.resolution}).${precipNote}
    Celda de la grilla: ${data.grid.lat}, ${data.grid.lon} · ${data.grid.elevation} m.</p>
    <p>Normal 1991–2020: para cada día se juntan los valores de ±7 días de los 30 años (unos 450 datos) y se
    calculan los percentiles 10, 50 y 90. La banda de lluvia sale de las acumuladas de ${years} años, día a día.</p>
    <p>El reanálisis llega con unos días de atraso: hay datos consolidados hasta el ${fmtDate(data.lastArchiveDate)}.
    Lo que sigue hasta hoy viene del modelo de pronóstico y se muestra punteado como dato preliminar.
    Un reanálisis representa el promedio de una celda de varios km: en zonas de montaña puede diferir bastante de una estación puntual.</p>`;
}

async function main() {
  const status = $("status");
  try {
    const data = await fetchPointData(PLACE.lat, PLACE.lon, MODEL);
    const year = Number(data.today.slice(0, 4));
    const clim = buildClimatology(data.archive, START_MONTH);
    const analysis = analyzeYear(data, clim, year);

    $("place").textContent = `${PLACE.name} · ${PLACE.lat}, ${PLACE.lon} · año ${year}`;
    document.querySelectorAll(".year-label").forEach((el) => (el.textContent = `Año ${year}`));
    status.textContent = `Datos hasta el ${fmtDate(data.today)} (${data.preliminary.dates.length} días preliminares).`;
    renderSummary(analysis.summary);
    renderSource(data, clim.precipAcc.years);

    const draw = () => renderCharts(analysis);
    draw();
    // Redibuja al cambiar el ancho (rotar el celular) o el tema claro/oscuro.
    let lastWidth = $("chart-temp").clientWidth;
    new ResizeObserver(() => {
      const w = $("chart-temp").clientWidth;
      if (w !== lastWidth) {
        lastWidth = w;
        draw();
      }
    }).observe($("chart-temp"));
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);
  } catch (e) {
    status.classList.add("error");
    status.textContent = `No se pudieron bajar los datos: ${e instanceof Error ? e.message : e}`;
  }
}

main();
