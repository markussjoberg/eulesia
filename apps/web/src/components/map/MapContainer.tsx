import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { type MapPoint, type MapBounds } from "../../lib/api";
import { useMapPoints } from "../../hooks/useApi";
import { useTheme } from "../../hooks/useTheme";
import { MapFilters } from "./MapFilters";
import { MapPopup } from "./MapPopup";
import type { MapFilterState } from "./types";
import { getBasemapStyle } from "./styles/basemap";

// Point type colors — same palette as before
const TYPE_COLORS: Record<string, string> = {
  municipality: "#2563eb",
  thread: "#9333ea",
  club: "#16a34a",
  place: "#ea580c",
};

function toGeoJSON(points: MapPoint[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [p.coordinates.longitude, p.coordinates.latitude],
      },
      properties: {
        id: p.id,
        pointType: p.pointType,
        name: p.name,
        meta: JSON.stringify(p.meta ?? {}),
      },
    })),
  };
}

function addPointLayers(map: maplibregl.Map) {
  // GeoJSON source with clustering
  map.addSource("points", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    cluster: true,
    clusterMaxZoom: 15,
    clusterRadius: 60,
    clusterProperties: {
      sum_municipality: [
        "+",
        ["case", ["==", ["get", "pointType"], "municipality"], 1, 0],
      ],
      sum_thread: ["+", ["case", ["==", ["get", "pointType"], "thread"], 1, 0]],
      sum_club: ["+", ["case", ["==", ["get", "pointType"], "club"], 1, 0]],
      sum_place: ["+", ["case", ["==", ["get", "pointType"], "place"], 1, 0]],
    },
  });

  // Cluster circles — color from dominant type
  map.addLayer({
    id: "clusters",
    type: "circle",
    source: "points",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": [
        "case",
        [
          "all",
          [">=", ["get", "sum_municipality"], ["get", "sum_thread"]],
          [">=", ["get", "sum_municipality"], ["get", "sum_club"]],
          [">=", ["get", "sum_municipality"], ["get", "sum_place"]],
        ],
        TYPE_COLORS.municipality,
        [
          "all",
          [">=", ["get", "sum_thread"], ["get", "sum_club"]],
          [">=", ["get", "sum_thread"], ["get", "sum_place"]],
        ],
        TYPE_COLORS.thread,
        [">=", ["get", "sum_club"], ["get", "sum_place"]],
        TYPE_COLORS.club,
        TYPE_COLORS.place,
      ],
      "circle-radius": ["step", ["get", "point_count"], 18, 10, 22, 50, 26],
      "circle-stroke-width": 3,
      "circle-stroke-color": "#ffffff",
      "circle-opacity": 0.9,
    },
  });

  // Cluster count label
  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "points",
    filter: ["has", "point_count"],
    layout: {
      "text-field": "{point_count_abbreviated}",
      "text-size": ["step", ["get", "point_count"], 13, 10, 12, 100, 11],
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": "#ffffff",
    },
  });

  // Unclustered individual points
  map.addLayer({
    id: "unclustered-point",
    type: "circle",
    source: "points",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": [
        "match",
        ["get", "pointType"],
        "municipality",
        TYPE_COLORS.municipality,
        "thread",
        TYPE_COLORS.thread,
        "club",
        TYPE_COLORS.club,
        "place",
        TYPE_COLORS.place,
        "#6b7280",
      ],
      "circle-radius": 8,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });
}

interface EulesiaMapProps {
  initialCenter?: [number, number];
  initialZoom?: number;
  filters: MapFilterState;
  onFiltersChange: (filters: MapFilterState) => void;
  onPointClick?: (point: MapPoint) => void;
}

export function EulesiaMap({
  initialCenter = [61.4978, 23.761], // Default: Tampere, Finland
  initialZoom = 6,
  filters,
  onFiltersChange,
  onPointClick,
}: EulesiaMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const boundsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointsDataRef = useRef<GeoJSON.FeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });

  const { resolvedTheme } = useTheme();
  const [bounds, setBounds] = useState<MapBounds | null>(null);

  const { data, isLoading } = useMapPoints(bounds, filters);
  const points = useMemo(() => data?.points || [], [data]);

  const handleBoundsChange = useCallback((newBounds: MapBounds) => {
    setBounds(newBounds);
  }, []);

  const emitBounds = useCallback(
    (map: maplibregl.Map) => {
      if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current);
      boundsTimerRef.current = setTimeout(() => {
        const b = map.getBounds();
        handleBoundsChange({
          north: b.getNorth(),
          south: b.getSouth(),
          east: b.getEast(),
          west: b.getWest(),
        });
      }, 300);
    },
    [handleBoundsChange],
  );

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: getBasemapStyle(resolvedTheme),
      center: [initialCenter[1], initialCenter[0]], // [lng, lat]
      zoom: initialZoom,
      attributionControl: { compact: true },
    });

    mapRef.current = map;

    map.on("load", () => {
      addPointLayers(map);

      const source = map.getSource("points") as maplibregl.GeoJSONSource;
      if (source) source.setData(pointsDataRef.current);

      emitBounds(map);
    });

    map.on("moveend", () => emitBounds(map));

    // Cluster click — zoom in
    map.on("click", "clusters", async (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: ["clusters"],
      });
      if (!features.length) return;
      const clusterId = features[0].properties.cluster_id;
      const source = map.getSource("points") as maplibregl.GeoJSONSource;
      const zoom = await source.getClusterExpansionZoom(clusterId);
      map.flyTo({
        center: (features[0].geometry as GeoJSON.Point).coordinates as [
          number,
          number,
        ],
        zoom,
      });
    });

    // Point click — show popup
    map.on("click", "unclustered-point", (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const coords = (
        feature.geometry as GeoJSON.Point
      ).coordinates.slice() as [number, number];
      const props = feature.properties;

      const point: MapPoint = {
        id: props.id,
        pointType: props.pointType,
        name: props.name,
        coordinates: {
          latitude: coords[1],
          longitude: coords[0],
        },
        meta: JSON.parse(props.meta || "{}"),
      };

      onPointClick?.(point);

      popupRef.current?.remove();

      const container = document.createElement("div");
      const root = createRoot(container);
      root.render(
        <MemoryRouter>
          <MapPopup point={point} />
        </MemoryRouter>,
      );

      popupRef.current = new maplibregl.Popup({
        closeButton: true,
        maxWidth: "320px",
      })
        .setLngLat(coords)
        .setDOMContent(container)
        .addTo(map);
    });

    // Cursor styles
    for (const layer of ["clusters", "unclustered-point"]) {
      map.on("mouseenter", layer, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
    }

    // Geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          map.flyTo({
            center: [position.coords.longitude, position.coords.latitude],
          });
        },
        () => {
          // Geolocation denied — stay at default center
        },
      );
    }

    return () => {
      if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current);
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync theme — skip the initial render (handled by mount effect)
  const initialThemeRef = useRef<string | null>(resolvedTheme);
  useEffect(() => {
    if (initialThemeRef.current) {
      initialThemeRef.current = null;
      return;
    }
    const map = mapRef.current;
    if (!map) return;

    map.setStyle(getBasemapStyle(resolvedTheme));

    map.once("style.load", () => {
      addPointLayers(map);
      const source = map.getSource("points") as maplibregl.GeoJSONSource;
      if (source) source.setData(pointsDataRef.current);
    });
  }, [resolvedTheme]);

  // Sync points data
  useEffect(() => {
    const geojson = toGeoJSON(points);
    pointsDataRef.current = geojson;

    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const source = map.getSource("points") as maplibregl.GeoJSONSource;
    if (source) source.setData(geojson);
  }, [points]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full" />

      <MapFilters filters={filters} onFiltersChange={onFiltersChange} />

      {isLoading && (
        <div className="absolute top-4 right-4 z-[1000] bg-white dark:bg-gray-900 rounded-lg shadow-lg px-3 py-2 flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Loading...
          </span>
        </div>
      )}
    </div>
  );
}
