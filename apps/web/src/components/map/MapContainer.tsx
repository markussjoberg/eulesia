import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  MapContainer as LeafletMap,
  TileLayer,
  Marker,
  Popup,
  useMap,
  useMapEvents,
} from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { type MapPoint, type MapBounds } from "../../lib/api";
import { useMapPoints } from "../../hooks/useApi";
import { MapFilters } from "./MapFilters";
import { MapPopup } from "./MapPopup";
import type { MapFilterState } from "./types";

// Custom marker icons — 32px for better touch targets on mobile
const MARKER_SIZE = 32;
const createIcon = (color: string) =>
  L.divIcon({
    className: "custom-marker",
    html: `<div style="
    background-color: ${color};
    width: ${MARKER_SIZE}px;
    height: ${MARKER_SIZE}px;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    border: 2px solid white;
    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  "></div>`,
    iconSize: [MARKER_SIZE, MARKER_SIZE],
    iconAnchor: [MARKER_SIZE / 2, MARKER_SIZE],
    popupAnchor: [0, -MARKER_SIZE],
  });

const icons = {
  municipality: createIcon("#2563eb"), // blue-600
  thread: createIcon("#9333ea"), // purple-600
  club: createIcon("#16a34a"), // green-600
  place: createIcon("#ea580c"), // orange-600
};

const typeColors: Record<string, string> = {
  municipality: "#2563eb",
  thread: "#9333ea",
  club: "#16a34a",
  place: "#ea580c",
};

// Custom cluster icon that shows dominant type color
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createClusterIcon(cluster: any) {
  const markers = cluster.getAllChildMarkers() as L.Marker[];
  const count = markers.length;

  // Count types
  const typeCounts: Record<string, number> = {};
  markers.forEach((m: L.Marker) => {
    const type = (m.options as { pointType?: string }).pointType || "place";
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  });

  // Find dominant type
  const dominantType =
    Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "place";
  const color = typeColors[dominantType] || "#6b7280";

  // Size based on count
  const size = count < 10 ? 36 : count < 50 ? 44 : 52;
  const fontSize = count < 10 ? 13 : count < 100 ? 12 : 11;

  return L.divIcon({
    html: `<div style="
      background-color: ${color};
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 700;
      font-size: ${fontSize}px;
      border: 3px solid white;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    ">${count}</div>`,
    className: "custom-cluster-icon",
    iconSize: L.point(size, size),
  });
}

// Component to handle map events with debounce
function MapEventHandler({
  onBoundsChange,
}: {
  onBoundsChange: (bounds: MapBounds) => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedBoundsChange = useCallback(
    (map: L.Map) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const bounds = map.getBounds();
        onBoundsChange({
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        });
      }, 300);
    },
    [onBoundsChange],
  );

  const map = useMapEvents({
    moveend: () => debouncedBoundsChange(map),
    zoomend: () => debouncedBoundsChange(map),
  });

  // Trigger initial bounds on mount
  useEffect(() => {
    const bounds = map.getBounds();
    onBoundsChange({
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
    });
  }, [map, onBoundsChange]);

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return null;
}

// Component to update map center
function MapCenterUpdater({ center }: { center: [number, number] | null }) {
  const map = useMap();

  useEffect(() => {
    if (center) {
      map.setView(center, map.getZoom());
    }
  }, [center, map]);

  return null;
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
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);

  const { data, isLoading } = useMapPoints(bounds, filters);
  const points = useMemo(() => data?.points || [], [data]);

  const handleBoundsChange = useCallback((newBounds: MapBounds) => {
    setBounds(newBounds);
  }, []);

  // Get user location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setMapCenter([position.coords.latitude, position.coords.longitude]);
        },
        () => {
          // Geolocation denied or failed, use default center
        },
      );
    }
  }, []);

  return (
    <div className="relative w-full h-full">
      <LeafletMap
        center={initialCenter}
        zoom={initialZoom}
        className="w-full h-full"
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapEventHandler onBoundsChange={handleBoundsChange} />
        <MapCenterUpdater center={mapCenter} />

        <MarkerClusterGroup
          chunkedLoading
          iconCreateFunction={createClusterIcon}
          maxClusterRadius={60}
          spiderfyOnMaxZoom
          showCoverageOnHover={false}
          disableClusteringAtZoom={16}
        >
          {points.map((point) => (
            <Marker
              key={`${point.pointType}-${point.id}`}
              position={[
                point.coordinates.latitude,
                point.coordinates.longitude,
              ]}
              icon={icons[point.pointType as keyof typeof icons]}
              // Store point type for cluster icon calculation
              {...({
                pointType: point.pointType,
              } as unknown as L.MarkerOptions)}
              eventHandlers={{
                click: () => onPointClick?.(point),
              }}
            >
              <Popup>
                <MapPopup point={point} />
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </LeafletMap>

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
