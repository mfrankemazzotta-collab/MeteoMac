import { describe, expect, it } from "vitest";
import { DEFAULT_STATE, parseState, periodLabel, serializeState } from "./state";

describe("parseState", () => {
  it("sin parámetros usa Bariloche, ERA5-Land y el año actual", () => {
    expect(parseState("")).toEqual(DEFAULT_STATE);
  });

  it("lee todos los parámetros", () => {
    expect(parseState("?lat=-42.91&lon=-71.32&lugar=Esquel&anio=2015&modelo=era5&hidro=1&comparar=1&temp=min")).toEqual({
      lat: -42.91,
      lon: -71.32,
      name: "Esquel",
      year: 2015,
      model: "era5",
      hydro: true,
      compare: true,
      tempVar: "min",
    });
  });

  it("acepta el modelo con guion o con guion bajo", () => {
    expect(parseState("?modelo=era5-land").model).toBe("era5_land");
    expect(parseState("?modelo=era5_land").model).toBe("era5_land");
    expect(parseState("?modelo=gfs").model).toBe("era5_land");
  });

  it("descarta valores inválidos", () => {
    const s = parseState("?lat=200&lon=-71&anio=1980&modelo=x");
    expect(s.lat).toBe(DEFAULT_STATE.lat);
    expect(s.year).toBe(null);
    expect(parseState("?anio=2010.5").year).toBe(null);
  });

  it("coordenadas sin nombre: no inventa el nombre de Bariloche", () => {
    const s = parseState("?lat=-34.6&lon=-58.4");
    expect(s.name).toBe(null);
    expect(s.lat).toBe(-34.6);
  });
});

describe("variable del mapa de colores", () => {
  it("acepta max y min; cualquier otra cosa es la media", () => {
    expect(parseState("?temp=max").tempVar).toBe("max");
    expect(parseState("?temp=min").tempVar).toBe("min");
    expect(parseState("?temp=xx").tempVar).toBe("mean");
  });
});

describe("serializeState", () => {
  it("ida y vuelta conserva el estado", () => {
    const s = { ...DEFAULT_STATE, name: "San Martín de los Andes", year: 2020, hydro: true, compare: true, tempVar: "max" as const };
    expect(parseState(serializeState(s))).toEqual(s);
  });

  it("redondea las coordenadas a 4 decimales y omite lo que está apagado", () => {
    const url = serializeState({ ...DEFAULT_STATE, lat: -41.123456, lon: -71.98766, year: 2026 });
    expect(url).toBe("?lat=-41.1235&lon=-71.9877&lugar=Bariloche&anio=2026&modelo=era5-land");
  });
});

describe("periodLabel", () => {
  it("muestra el año o el período hidrológico", () => {
    expect(periodLabel(2026, false)).toBe("2026");
    expect(periodLabel(2025, true)).toBe("2025–26");
    expect(periodLabel(1999, true)).toBe("1999–00");
  });
});
