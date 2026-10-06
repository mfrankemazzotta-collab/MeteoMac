import "./style.css";
import { fetchPointData, MODEL_INFO, type Model, type PointData } from "./data/openmeteo";
import { yearRows, type DayRow } from "./data/year";
import { precipitationChart, temperatureChart } from "./charts/charts";

// Fase 1: ubicación y modelo fijos. En la fase 3 pasan a ser controles y parámetros de la URL.
const PLACE = { name: "Bariloche", lat: -41.1082, lon: -71.4341 };
const MODEL: Model = "era5_land";

const $ = (id: string) => document.getElementById(id)!;
const dateFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmtDate = (iso: string) => dateFmt.format(new Date(iso + "T00:00:00Z"));

function renderCharts(rows: DayRow[], year: number) {
  for (const [id, chart] of [
    ["chart-temp", temperatureChart],
    ["chart-precip", precipitationChart],
  ] as const) {
    const el = $(id);
    el.replaceChildren(chart({ rows, year, width: el.clientWidth }));
  }
}

function renderSource(data: PointData) {
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
    <p>El reanálisis llega con unos días de atraso: hay datos consolidados hasta el ${fmtDate(data.lastArchiveDate)}.
    Lo que sigue hasta hoy viene del modelo de pronóstico y se muestra punteado como dato preliminar.
    Un reanálisis representa el promedio de una celda de varios km: en zonas de montaña puede diferir bastante de una estación puntual.</p>`;
}

async function main() {
  const status = $("status");
  try {
    const data = await fetchPointData(PLACE.lat, PLACE.lon, MODEL);
    const year = Number(data.today.slice(0, 4));
    const rows = yearRows(data, year);

    $("place").textContent = `${PLACE.name} · ${PLACE.lat}, ${PLACE.lon} · año ${year}`;
    status.textContent = `Datos hasta el ${fmtDate(data.today)} (${data.preliminary.dates.length} días preliminares).`;
    renderSource(data);

    const draw = () => renderCharts(rows, year);
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
