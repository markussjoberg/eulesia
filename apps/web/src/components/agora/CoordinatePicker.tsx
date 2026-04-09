import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { X, MapPin, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getBasemapStyle } from "../map/styles/basemap";
import { useTheme } from "../../hooks/useTheme";

export interface PickedCoordinate {
  latitude: number;
  longitude: number;
}

interface CoordinatePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (coords: PickedCoordinate) => void;
  initialCenter?: [number, number]; // [lat, lng]
}

export function CoordinatePicker({
  isOpen,
  onClose,
  onSelect,
  initialCenter = [61.4978, 23.761],
}: CoordinatePickerProps) {
  const { t } = useTranslation("agora");
  const { resolvedTheme } = useTheme();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  const [selected, setSelected] = useState<PickedCoordinate | null>(null);

  const handleMapClick = useCallback((e: maplibregl.MapMouseEvent) => {
    const { lng, lat } = e.lngLat;
    setSelected({ latitude: lat, longitude: lng });

    if (markerRef.current) {
      markerRef.current.setLngLat([lng, lat]);
    } else if (mapRef.current) {
      markerRef.current = new maplibregl.Marker({ color: "#2563eb" })
        .setLngLat([lng, lat])
        .addTo(mapRef.current);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: getBasemapStyle(resolvedTheme),
      center: [initialCenter[1], initialCenter[0]],
      zoom: 6,
    });

    mapRef.current = map;

    map.on("click", handleMapClick);

    // Try to center on user location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          map.flyTo({
            center: [pos.coords.longitude, pos.coords.latitude],
            zoom: 10,
          });
        },
        () => {
          // denied — stay at default
        },
      );
    }

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
      setSelected(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleConfirm = () => {
    if (selected) {
      onSelect(selected);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-white dark:bg-gray-950"
      role="dialog"
      aria-modal="true"
      aria-label={t("threadForm.pickCoordinates", "Pick a location on the map")}
      data-testid="coordinate-picker"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 z-10">
        <div className="flex items-center gap-2">
          <MapPin className="w-5 h-5 text-blue-600" />
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {t("threadForm.pickCoordinates", "Pick a location on the map")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {selected && (
            <span className="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline">
              {selected.latitude.toFixed(4)}, {selected.longitude.toFixed(4)}
            </span>
          )}
          <button
            onClick={handleConfirm}
            disabled={!selected}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check className="w-4 h-4" />
            {t("threadForm.confirmLocation", "Confirm")}
          </button>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
            aria-label={t("common:actions.close", "Close")}
          >
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>
      </div>

      {/* Map fills remaining space */}
      <div ref={mapContainerRef} className="flex-1" />

      {/* Bottom hint */}
      {!selected && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/70 text-white text-sm rounded-full pointer-events-none">
          {t("threadForm.tapToPlace", "Tap the map to place a pin")}
        </div>
      )}
    </div>
  );
}
