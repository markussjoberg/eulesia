import { describe, it, expect } from "vitest";
import { toContentGeoJSON, toMunicipalityGeoJSON } from "./MapContainer";

const samplePoints = [
  {
    id: "t1",
    pointType: "thread" as const,
    name: "Thread 1",
    coordinates: { latitude: 60.17, longitude: 24.94 },
    meta: { scope: "local" },
  },
  {
    id: "m1",
    pointType: "municipality" as const,
    name: "Helsinki",
    coordinates: { latitude: 60.17, longitude: 24.94 },
    meta: { population: 674500, threadCount: 42 },
  },
  {
    id: "c1",
    pointType: "club" as const,
    name: "Club 1",
    coordinates: { latitude: 61.5, longitude: 23.8 },
    meta: {},
  },
];

describe("toContentGeoJSON", () => {
  it("excludes municipality points", () => {
    const geojson = toContentGeoJSON(samplePoints);
    const types = geojson.features.map(
      (f) => (f.properties as Record<string, unknown>).pointType,
    );
    expect(types).not.toContain("municipality");
    expect(types).toContain("thread");
    expect(types).toContain("club");
  });

  it("returns empty collection for empty input", () => {
    const geojson = toContentGeoJSON([]);
    expect(geojson.features).toHaveLength(0);
    expect(geojson.type).toBe("FeatureCollection");
  });
});

describe("toMunicipalityGeoJSON", () => {
  it("only includes municipality points", () => {
    const geojson = toMunicipalityGeoJSON(samplePoints);
    expect(geojson.features).toHaveLength(1);
    const props = geojson.features[0].properties as Record<string, unknown>;
    expect(props.name).toBe("Helsinki");
    expect(props.population).toBe(674500);
    expect(props.threadCount).toBe(42);
  });

  it("returns empty collection when no municipalities", () => {
    const geojson = toMunicipalityGeoJSON([
      {
        id: "t1",
        pointType: "thread" as const,
        name: "T",
        coordinates: { latitude: 60, longitude: 25 },
        meta: {},
      },
    ]);
    expect(geojson.features).toHaveLength(0);
  });
});
