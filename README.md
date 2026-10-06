# MeteoMac

Página web estática que muestra cómo viene el año en **temperatura media diaria** y **precipitación acumulada** para un punto, comparado con la climatología 1991–2020. Alternativa más liviana y usable en el celular a [PointWx Daily Climate](https://hh.guidocioni.it/pointwx/dailyclimate).

Ubicación de referencia: Bariloche (lat −41.1082, lon −71.4341).

## Estado

| Fase | Estado |
|---|---|
| 1. Prototipo: Bariloche fijo, datos y dos gráficos | ✅ |
| 2. Climatología: suavizado, percentiles, resumen, tests | ✅ |
| 3. Interfaz: controles, URL, celular, temas | pendiente |
| 4. Deploy: GitHub Pages + Action | pendiente |
| 5. Extras: estación del SMN, exportar CSV | pendiente |

## Correrlo en tu compu

Requiere [Node.js](https://nodejs.org/) 20 o más nuevo.

```bash
npm install
npm run dev
```

Abrí http://localhost:5173.

Otros comandos:

- `npm test`: corre los tests de los cálculos (Vitest).
- `npm run build`: chequea tipos y genera la versión final en `dist/`.
- `npm run preview`: sirve `dist/` para probarla.

## Estructura

```
index.html            página (estructura y textos fijos)
src/
  main.ts             arranque: baja los datos y dibuja
  style.css           estilos y colores (tema claro/oscuro)
  data/
    openmeteo.ts      consultas a Open-Meteo (reanálisis + pronóstico)
    cache.ts          caché de respuestas en IndexedDB
    dates.ts          utilidades de fechas
    climatology.ts    percentiles 1991–2020 (ventana ±7 días, acumuladas)
    analysis.ts       cruza el año con la climatología + resumen
    *.test.ts         tests (Vitest)
  charts/
    charts.ts         gráficos con Observable Plot
```

Los cálculos (`src/data/`) no tocan la interfaz, así se pueden testear por separado.

## Datos

- **Reanálisis**: [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api), variables diarias `temperature_2m_mean` y `precipitation_sum`, `timezone=auto`, modelos `era5` y `era5_land`. Se hace una sola consulta desde 1991-01-01 hasta el último día disponible.
- **Hueco hasta hoy**: el reanálisis llega con unos 5 a 7 días de atraso. Esos días se completan con la [API de pronóstico](https://open-meteo.com/en/docs) (`past_days`) y se dibujan punteados como *datos preliminares*.
- **ERA5-Land no tiene precipitación en Open-Meteo**: la API devuelve `null` en toda la serie. Con ERA5-Land, la temperatura sale de ERA5-Land y la precipitación de ERA5, y la página lo aclara.
- Las respuestas se guardan en el navegador (12 h el reanálisis, 1 h el pronóstico). Open-Meteo cuenta una serie de 35 años como muchas consultas y limita por minuto.

## Método de climatología

- **Período base**: 1991–2020, del mismo reanálisis que se muestra (así el año y la normal son comparables).
- **Temperatura**: para cada día del año se juntan los valores de ±7 días de los 30 años (450 datos) y se calculan los percentiles 10, 50 y 90 con interpolación lineal (como NumPy/R). La ventana da la vuelta al año: el 3 de enero usa días de fines de diciembre.
- **Lluvia acumulada**: se arma la acumulada de cada año base y, día a día, se sacan los percentiles sobre esas 30 trayectorias (sin ventana). Un año base con días sin dato se descarta.
- **29 de febrero**: comparte posición con el 28. Su temperatura entra en la ventana de ese día y su lluvia se suma a la acumulada del 28, así que marzo no se corre un día en los años bisiestos.
- **Percentil de cada día**: porcentaje de la distribución que queda por debajo, contando la mitad de los empates.
- **Resumen**: lluvia acumulada como % de la mediana a la misma fecha; anomalía de temperatura = promedio de (T del día − T media normal de ese día).
- Las funciones aceptan un mes de inicio, listas para el año hidrológico (abril–marzo).

## Dependencias

- [`@observablehq/plot`](https://observablehq.com/plot/): gráficos en SVG. Hace fácil dibujar bandas y colorear días puntuales, que llegan en la fase 2, y el SVG es accesible y respeta el tema.
- `vite`, `typescript` y `vitest` (solo para desarrollo; Vitest corre los tests).
