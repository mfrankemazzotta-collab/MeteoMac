import "./style.css";
import { fetchPointData, MODEL_INFO, MODELS, PRECIP_MODEL, seriesFor, type Model, type PointData } from "./data/openmeteo";
import { analyzeYear, buildClimatology, type PointClimatology, type Summary } from "./data/analysis";
import { dailyClimatology, periodYear, type Climatology } from "./data/climatology";
import { dailyAnomalies, TEMP_VAR_INFO, yearlyAnomalies, type TempVar } from "./data/anomalies";
import { calendarChart, calendarLimit, colorLegend, stripesChart, stripesLimit } from "./charts/anomalyCharts";
import { searchPlaces, type Place } from "./data/geocoding";
import { num, precipitationChart, temperatureChart } from "./charts/charts";
import { FIRST_YEAR, parseState, periodLabel, roundCoord, serializeState, type AppState } from "./state";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const dateFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtDate = (iso: string, f = dateFmt) => f.format(new Date(iso + "T00:00:00Z"));

const ui = {
  place: $("place"),
  status: $("status"),
  summary: $("summary"),
  source: $("source"),
  q: $<HTMLInputElement>("q"),
  results: $<HTMLUListElement>("results"),
  year: $<HTMLSelectElement>("year"),
  model: $<HTMLSelectElement>("model"),
  hydro: $<HTMLInputElement>("hydro"),
  compare: $<HTMLInputElement>("compare"),
  chartTemp: $("chart-temp"),
  chartPrecip: $("chart-precip"),
  chartStripes: $("chart-stripes"),
  chartCalendar: $("chart-calendar"),
  rampStripes: $("ramp-stripes"),
  rampCalendar: $("ramp-calendar"),
  mapNote: $("map-note"),
};

let state: AppState = parseState(location.search);
let data: PointData | null = null;
const climCache = new Map<string, PointClimatology>();
const varClimCache = new Map<string, Climatology>();
let requestId = 0;
let lastRender: (() => void) | null = null;

// ---------- Datos ----------

const otherModel = (m: Model): Model => (m === "era5" ? "era5_land" : "era5");
const neededModels = (s: AppState): Model[] => (s.compare ? MODELS : [s.model]);

/** ¿Los datos en memoria sirven para este estado? (mismo punto y todos los modelos necesarios) */
function dataCovers(d: PointData | null, s: AppState): d is PointData {
  return (
    d != null &&
    d.requested.lat === s.lat &&
    d.requested.lon === s.lon &&
    neededModels(s).every((m) => d.archive[m] != null)
  );
}

/** Climatología diaria de la temperatura media, máxima o mínima (no depende del mes de inicio). */
function varClimatology(d: PointData, model: Model, v: TempVar): Climatology {
  const key = `${model}|var|${v}`;
  let c = varClimCache.get(key);
  if (!c) {
    const archive = seriesFor(d, model).archive;
    varClimCache.set(key, (c = dailyClimatology(archive.dates, archive[TEMP_VAR_INFO[v].key])));
  }
  return c;
}

function climatology(d: PointData, model: Model, startMonth: number): PointClimatology {
  const key = `${model}|${startMonth}`;
  let c = climCache.get(key);
  if (!c) climCache.set(key, (c = buildClimatology(seriesFor(d, model).archive, startMonth)));
  return c;
}

async function update() {
  syncControls();
  if (!dataCovers(data, state)) {
    const id = ++requestId;
    setStatus("Descargando datos de Open-Meteo…");
    try {
      const d = await fetchPointData(state.lat, state.lon, neededModels(state));
      if (id !== requestId) return; // llegó tarde: el usuario ya pidió otra cosa
      data = d;
      climCache.clear();
      varClimCache.clear();
    } catch (e) {
      if (id !== requestId) return;
      setStatus(`No se pudieron bajar los datos: ${e instanceof Error ? e.message : e}`, true);
      return;
    }
  }
  render(data!);
}

// ---------- Dibujo ----------

function setStatus(text: string, error = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle("error", error);
}

function render(d: PointData) {
  const startMonth = state.hydro ? 4 : 1;
  const maxYear = periodYear(d.today, startMonth);
  const year = Math.min(Math.max(state.year ?? maxYear, FIRST_YEAR), maxYear);
  fillYears(maxYear, year);

  const analysis = analyzeYear(seriesFor(d, state.model), climatology(d, state.model, startMonth), year);
  const other = otherModel(state.model);
  const compare = state.compare ? analyzeYear(seriesFor(d, other), climatology(d, other, startMonth), year) : undefined;

  // La URL siempre refleja lo que se ve, con el año resuelto, para compartirla tal cual.
  history.replaceState(null, "", serializeState({ ...state, year }));

  const label = periodLabel(year, state.hydro);
  const where = state.name ?? `${roundCoord(state.lat)}, ${roundCoord(state.lon)}`;
  ui.place.textContent = `${where} · ${state.hydro ? "año hidrológico " : ""}${label}`;
  document.title = `${where} ${label} · MeteoMac`;
  document.querySelectorAll(".year-label").forEach((el) => (el.textContent = state.hydro ? `Año hidrológico ${label}` : `Año ${label}`));
  document.querySelectorAll(".compare-label").forEach((el) => (el.textContent = MODEL_INFO[other].label));
  document.querySelectorAll<HTMLElement>(".compare-only").forEach((el) => (el.hidden = !compare));
  const hasPrelim = analysis.summary.preliminaryDays > 0;
  document.querySelectorAll<HTMLElement>(".prelim-only").forEach((el) => (el.hidden = !hasPrelim));

  const current = year === maxYear;
  setStatus(
    current
      ? `Datos hasta el ${fmtDate(d.today)}. Los últimos ${analysis.summary.preliminaryDays} días son preliminares.`
      : `Período completo: ${fmtDate(analysis.periodStart, shortFmt)} al ${fmtDate(analysis.periodEnd, shortFmt)}.`,
  );
  renderSummary(analysis.summary, compare?.summary, current);
  renderSource(d, climatology(d, state.model, startMonth).precipAcc.years);

  // Mapa de colores: anomalías diarias de la variable elegida, todos los años.
  const v = state.tempVar;
  const vLabel = TEMP_VAR_INFO[v].label;
  const mapDays = dailyAnomalies(seriesFor(d, state.model), varClimatology(d, state.model, v), v, startMonth).filter(
    (x) => x.year >= FIRST_YEAR,
  );
  const mapYears = yearlyAnomalies(mapDays);
  const yearLabel = (y: number) => periodLabel(y, state.hydro);
  document.querySelectorAll<HTMLInputElement>("input[name=tempvar]").forEach((r) => (r.checked = r.value === v));
  $("stripes-title").textContent = `Franjas: anomalía de la T ${vLabel} ${state.hydro ? "por año hidrológico" : "anual"}`;
  $("calendar-title").textContent = `Calendario: anomalía de la T ${vLabel} de cada día`;
  const lastYear = mapYears[mapYears.length - 1];
  ui.mapNote.textContent =
    `Anomalía = valor − promedio 1991–2020 para ese día del año (${MODEL_INFO[state.model].label}). ` +
    `Rojo: más cálido que lo normal; azul: más frío. ` +
    (lastYear && !lastYear.complete
      ? `${yearLabel(lastYear.year)} está incompleto (${lastYear.days} días, borde punteado): se compara con lo normal para esos mismos días.`
      : "");

  // Ancho mínimo de dibujo: si el contenedor todavía mide ~0 px (al abrir la página o rotar),
  // Plot calcularía anchos negativos. El SVG igual se achica para entrar en el contenedor.
  const widthOf = (el: HTMLElement) => Math.max(280, el.clientWidth);

  lastRender = () => {
    ui.chartTemp.replaceChildren(
      temperatureChart({ analysis, width: widthOf(ui.chartTemp), compare, compareLabel: MODEL_INFO[other].label }),
    );
    ui.chartPrecip.replaceChildren(precipitationChart({ analysis, width: widthOf(ui.chartPrecip) }));
    const w = widthOf(ui.chartStripes);
    ui.rampStripes.replaceChildren(colorLegend(stripesLimit(mapYears), w));
    ui.chartStripes.replaceChildren(stripesChart({ years: mapYears, width: w, label: yearLabel }));
    ui.rampCalendar.replaceChildren(colorLegend(calendarLimit(mapDays), w));
    ui.chartCalendar.replaceChildren(
      calendarChart({ days: mapDays, width: w, startMonth, label: yearLabel, variableLabel: vLabel }),
    );
  };
  lastRender();
}

/** Resumen de una línea. Signos y palabras acompañan al número para no depender del color. */
function renderSummary(s: Summary, compare: Summary | undefined, current: boolean) {
  const parts: string[] = [];
  const when = current ? "a la fecha" : "en el período";
  if (s.rainPctOfMedian != null) {
    parts.push(
      `Lluvia: <strong>${num(s.rainPctOfMedian, 0)} %</strong> de la mediana ${when} ` +
        `<span class="detail">(${num(s.rainAcc, 0)} mm vs. ${num(s.rainMedian, 0)} mm)</span>`,
    );
  }
  // Redondeamos antes de elegir el signo, para no mostrar "+0,0" ni "−0,0".
  const round1 = (a: number) => Math.round(a * 10) / 10;
  const anomaly = (a: number) => {
    const r = round1(a);
    return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${num(Math.abs(r))} °C`;
  };
  if (s.tempAnomaly != null) {
    const r = round1(s.tempAnomaly);
    const word = r > 0 ? "más cálido que" : r < 0 ? "más frío que" : "igual que";
    let text = `Temperatura: <strong>${anomaly(s.tempAnomaly)}</strong> ${word} 1991–2020`;
    if (compare?.tempAnomaly != null) {
      text += ` <span class="detail">(${MODEL_INFO[otherModel(state.model)].label}: ${anomaly(compare.tempAnomaly)})</span>`;
    }
    parts.push(text);
  }
  ui.summary.innerHTML = parts.join('<span class="sep" aria-hidden="true">·</span> ');
  ui.summary.hidden = parts.length === 0;
}

function renderSource(d: PointData, years: number) {
  const t = MODEL_INFO[state.model];
  const p = MODEL_INFO[PRECIP_MODEL];
  const precipNote =
    state.model !== PRECIP_MODEL
      ? ` La precipitación sale de ${p.label} (${p.resolution}) porque Open-Meteo no publica lluvia para ${t.label}.`
      : "";
  ui.source.innerHTML = `
    <p>Datos: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>.
    Temperatura: reanálisis ${t.label} (${t.resolution}).${precipNote}
    Elevación usada para la temperatura: ${num(d.elevation, 0)} m.</p>
    <p>Normal 1991–2020: para cada día se juntan los valores de ±7 días de los 30 años (unos 450 datos) y se
    calculan los percentiles 10, 50 y 90. La banda de lluvia sale de las acumuladas de ${years} períodos, día a día.</p>
    <p>El reanálisis llega con unos días de atraso: hay datos consolidados hasta el ${fmtDate(d.lastArchiveDate)}.
    Lo que sigue hasta hoy viene del modelo de pronóstico y se muestra punteado como dato preliminar.
    Un reanálisis representa el promedio de una celda de varios km: en zonas de montaña puede diferir bastante de una estación puntual.</p>`;
}

// ---------- Controles ----------

function fillYears(maxYear: number, selected: number) {
  const hydro = state.hydro;
  if (ui.year.dataset.max !== `${maxYear}|${hydro}`) {
    ui.year.dataset.max = `${maxYear}|${hydro}`;
    ui.year.replaceChildren(
      ...Array.from({ length: maxYear - FIRST_YEAR + 1 }, (_, i) => {
        const y = maxYear - i;
        return new Option(periodLabel(y, hydro), String(y));
      }),
    );
  }
  ui.year.value = String(selected);
}

function syncControls() {
  ui.model.value = state.model;
  ui.hydro.checked = state.hydro;
  ui.compare.checked = state.compare;
  if (document.activeElement !== ui.q) ui.q.value = state.name ?? "";
}

function setState(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  void update();
}

ui.year.addEventListener("change", () => setState({ year: Number(ui.year.value) }));
ui.model.addEventListener("change", () => setState({ model: ui.model.value as Model }));
ui.compare.addEventListener("change", () => setState({ compare: ui.compare.checked }));
document.querySelectorAll<HTMLInputElement>("input[name=tempvar]").forEach((r) =>
  r.addEventListener("change", () => r.checked && setState({ tempVar: r.value as TempVar })),
);
// Al pasar a año hidrológico (o volver), el año elegido deja de significar lo mismo: volvemos al actual.
ui.hydro.addEventListener("change", () => setState({ hydro: ui.hydro.checked, year: null }));
$("controls").addEventListener("submit", (e) => {
  e.preventDefault();
  ui.results.querySelector("button")?.click();
});

// ---------- Buscador ----------

let searchTimer: number | undefined;
let searchAbort: AbortController | null = null;

function closeResults() {
  ui.results.hidden = true;
  ui.q.setAttribute("aria-expanded", "false");
}

function showResults(places: Place[]) {
  const items = places.map((p) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    const b = document.createElement("button");
    b.type = "button";
    b.append(p.name);
    if (p.detail) {
      const detail = document.createElement("span");
      detail.className = "detail";
      detail.textContent = ` · ${p.detail}`;
      b.append(detail);
    }
    b.addEventListener("click", () => {
      closeResults();
      ui.q.value = p.name;
      setState({ lat: roundCoord(p.lat), lon: roundCoord(p.lon), name: p.name });
    });
    li.append(b);
    return li;
  });
  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No encontré ese lugar.";
    items.push(li);
  }
  ui.results.replaceChildren(...items);
  ui.results.hidden = false;
  ui.q.setAttribute("aria-expanded", "true");
}

ui.q.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const query = ui.q.value;
  if (query.trim().length < 2) return closeResults();
  // Espera a que se deje de tipear para no consultar en cada letra.
  searchTimer = window.setTimeout(async () => {
    searchAbort?.abort();
    searchAbort = new AbortController();
    try {
      showResults(await searchPlaces(query, searchAbort.signal));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setStatus("No se pudo buscar el lugar. Probá de nuevo.", true);
    }
  }, 300);
});

ui.q.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    ui.results.querySelector("button")?.focus();
  } else if (e.key === "Escape") {
    closeResults();
  }
});

ui.results.addEventListener("keydown", (e) => {
  const buttons = [...ui.results.querySelectorAll("button")];
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === "ArrowDown") buttons[Math.min(i + 1, buttons.length - 1)]?.focus();
  else if (e.key === "ArrowUp") (i <= 0 ? ui.q : buttons[i - 1]).focus();
  else if (e.key === "Escape") {
    closeResults();
    ui.q.focus();
  } else return;
  e.preventDefault();
});

document.addEventListener("click", (e) => {
  if (!(e.target as Element).closest(".field.search")) closeResults();
});

// ---------- Tema claro / oscuro ----------

const THEMES = ["auto", "light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const THEME_TEXT: Record<Theme, [string, string]> = {
  auto: ["◐", "Automático"],
  light: ["☀", "Claro"],
  dark: ["☾", "Oscuro"],
};

function currentTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "auto";
}

function applyTheme(t: Theme) {
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try {
    if (t === "auto") localStorage.removeItem("meteomac-theme");
    else localStorage.setItem("meteomac-theme", t);
  } catch {
    // sin almacenamiento: el tema dura hasta recargar
  }
  const [icon, text] = THEME_TEXT[t];
  $("theme-icon").textContent = icon;
  $("theme-text").textContent = text;
  $("theme").setAttribute("aria-label", `Tema: ${text}. Cambiar tema`);
  lastRender?.();
}

$("theme").addEventListener("click", () => applyTheme(THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length]));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => lastRender?.());

// ---------- Arranque ----------

// Redibuja al cambiar el ancho (rotar el celular).
let lastWidth = ui.chartTemp.clientWidth;
new ResizeObserver(() => {
  const w = ui.chartTemp.clientWidth;
  if (w !== lastWidth) {
    lastWidth = w;
    lastRender?.();
  }
}).observe(ui.chartTemp);

applyTheme(currentTheme());
void update();
