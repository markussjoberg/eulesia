import type { StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";

// PMTiles source URL — override via VITE_PMTILES_URL env var.
// Default: Protomaps daily build (self-host for production).
const PMTILES_URL =
  import.meta.env.VITE_PMTILES_URL ??
  "https://build.protomaps.com/20260408.pmtiles";

const SOURCE_NAME = "protomaps";

// Register PMTiles protocol once
let protocolRegistered = false;
export function ensurePmtilesProtocol() {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  protocolRegistered = true;
}

// Lazy import avoidance — we call addProtocol via the map instance instead
import maplibregl from "maplibre-gl";

const sharedSource = {
  [SOURCE_NAME]: {
    type: "vector" as const,
    url: `pmtiles://${PMTILES_URL}`,
    attribution:
      '<a href="https://protomaps.com">Protomaps</a> &copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
  },
};

// Road class filter — show only major roads to keep the map clean
const roadFilter = [
  "match",
  ["get", "kind"],
  ["highway", "major_road"],
  true,
  false,
] as const;

// Boundary filter — country borders only
const boundaryFilter = ["==", ["get", "kind"], "country"] as const;

const lightStyle: StyleSpecification = {
  version: 8,
  sources: sharedSource,
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#f8f9fa" },
    },
    {
      id: "water",
      type: "fill",
      source: SOURCE_NAME,
      "source-layer": "water",
      paint: { "fill-color": "#c8dff0" },
    },
    {
      id: "waterway",
      type: "line",
      source: SOURCE_NAME,
      "source-layer": "water",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": "#c8dff0",
        "line-width": 1,
      },
    },
    {
      id: "roads",
      type: "line",
      source: SOURCE_NAME,
      "source-layer": "roads",
      filter: roadFilter as unknown as maplibregl.FilterSpecification,
      paint: {
        "line-color": "#dfe3e8",
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 12, 2],
      },
    },
    {
      id: "boundaries",
      type: "line",
      source: SOURCE_NAME,
      "source-layer": "boundaries",
      filter: boundaryFilter as unknown as maplibregl.FilterSpecification,
      paint: {
        "line-color": "#9ca3af",
        "line-width": 1.5,
        "line-dasharray": [4, 2],
      },
    },
  ],
};

const darkStyle: StyleSpecification = {
  version: 8,
  sources: sharedSource,
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#0f172a" },
    },
    {
      id: "water",
      type: "fill",
      source: SOURCE_NAME,
      "source-layer": "water",
      paint: { "fill-color": "#172554" },
    },
    {
      id: "waterway",
      type: "line",
      source: SOURCE_NAME,
      "source-layer": "water",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": "#172554",
        "line-width": 1,
      },
    },
    {
      id: "roads",
      type: "line",
      source: SOURCE_NAME,
      "source-layer": "roads",
      filter: roadFilter as unknown as maplibregl.FilterSpecification,
      paint: {
        "line-color": "#1e293b",
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 12, 2],
      },
    },
    {
      id: "boundaries",
      type: "line",
      source: SOURCE_NAME,
      "source-layer": "boundaries",
      filter: boundaryFilter as unknown as maplibregl.FilterSpecification,
      paint: {
        "line-color": "#475569",
        "line-width": 1.5,
        "line-dasharray": [4, 2],
      },
    },
  ],
};

export function getBasemapStyle(theme: "light" | "dark"): StyleSpecification {
  return theme === "dark" ? darkStyle : lightStyle;
}
