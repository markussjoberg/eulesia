import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CoordinatePicker } from "./CoordinatePicker";

// Mock maplibre-gl — it requires a browser canvas
vi.mock("maplibre-gl", () => {
  const Marker = vi.fn().mockImplementation(() => ({
    setLngLat: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  }));

  const Map = vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    remove: vi.fn(),
    flyTo: vi.fn(),
    getCanvas: vi.fn(() => ({ style: {} })),
  }));

  return {
    default: { Map, Marker, Popup: vi.fn() },
    Map,
    Marker,
    Popup: vi.fn(),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("../../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("../map/styles/basemap", () => ({
  getBasemapStyle: () => ({
    version: 8,
    sources: {},
    layers: [],
  }),
}));

describe("CoordinatePicker", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <CoordinatePicker isOpen={false} onClose={vi.fn()} onSelect={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders overlay when open", () => {
    render(
      <CoordinatePicker isOpen={true} onClose={vi.fn()} onSelect={vi.fn()} />,
    );
    expect(screen.getByTestId("coordinate-picker")).toBeTruthy();
  });

  it("confirm button is disabled when no pin is placed", () => {
    render(
      <CoordinatePicker isOpen={true} onClose={vi.fn()} onSelect={vi.fn()} />,
    );
    const confirmBtn = screen.getByRole("button", { name: /confirm/i });
    expect(confirmBtn).toBeDisabled();
  });
});
