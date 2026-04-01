import { useState, useEffect } from "react";
import {
  X,
  MapPin,
  Building2,
  Globe,
  Loader2,
  Hash,
  Plus,
  ChevronDown,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCreateThread } from "../../hooks/useApi";
import { useAuth } from "../../hooks/useAuth";
import { LocationSearch } from "../common/LocationSearch";
import type { Scope } from "../../types";
import type { LocationResult } from "../../lib/api";

const SUPPORTED_COUNTRIES: { code: string; flag: string; name: string }[] = [
  { code: "FI", flag: "\u{1F1EB}\u{1F1EE}", name: "Suomi" },
  { code: "SE", flag: "\u{1F1F8}\u{1F1EA}", name: "Sverige" },
  { code: "EE", flag: "\u{1F1EA}\u{1F1EA}", name: "Eesti" },
  { code: "DE", flag: "\u{1F1E9}\u{1F1EA}", name: "Deutschland" },
  { code: "FR", flag: "\u{1F1EB}\u{1F1F7}", name: "France" },
  { code: "NL", flag: "\u{1F1F3}\u{1F1F1}", name: "Nederland" },
  { code: "IT", flag: "\u{1F1EE}\u{1F1F9}", name: "Italia" },
  { code: "ES", flag: "\u{1F1EA}\u{1F1F8}", name: "Espa\u00f1a" },
];

function getDefaultCountry(locale?: string): string {
  const localeMap: Record<string, string> = {
    fi: "FI",
    sv: "SE",
    et: "EE",
    de: "DE",
    fr: "FR",
    nl: "NL",
    it: "IT",
    es: "ES",
  };
  if (locale) {
    const lang = locale.split("-")[0].toLowerCase();
    if (localeMap[lang]) return localeMap[lang];
  }
  return "FI";
}

interface NewThreadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (threadId: string) => void;
  // Pre-filled context (e.g., from municipality/location page)
  prefilledMunicipalityId?: string;
  prefilledMunicipalityName?: string;
  prefilledLocation?: LocationResult;
}

// Common tags for quick selection
const suggestedTags = [
  "liikenne",
  "koulutus",
  "terveys",
  "ympäristö",
  "asuminen",
  "kulttuuri",
  "talous",
  "turvallisuus",
  "sosiaalipalvelut",
  "infrastruktuuri",
];

export function NewThreadModal({
  isOpen,
  onClose,
  onSuccess,
  prefilledMunicipalityId,
  prefilledMunicipalityName,
  prefilledLocation,
}: NewThreadModalProps) {
  const { t } = useTranslation("agora");
  const { currentUser } = useAuth();
  const createThreadMutation = useCreateThread();

  const scopeOptions: {
    value: Scope;
    icon: React.ElementType;
    label: string;
    description: string;
  }[] = [
    {
      value: "local",
      icon: MapPin,
      label: t("threadForm.scopeLocal"),
      description: t("threadForm.scopeLocalDesc"),
    },
    {
      value: "national",
      icon: Building2,
      label: t("threadForm.scopeNational"),
      description: t("threadForm.scopeNationalDesc"),
    },
    {
      value: "european",
      icon: Globe,
      label: t("threadForm.scopeEuropean"),
      description: t("threadForm.scopeEuropeanDesc"),
    },
  ];

  // Form state
  const [scope, setScope] = useState<Scope>("local");
  const [country, setCountry] = useState(() =>
    getDefaultCountry(currentUser?.settings?.locale),
  );
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [selectedLocation, setSelectedLocation] =
    useState<LocationResult | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set prefilled values
  useEffect(() => {
    if (prefilledLocation) {
      setSelectedLocation(prefilledLocation);
      setScope("local");
    } else if (prefilledMunicipalityId && prefilledMunicipalityName) {
      // Legacy municipality support - convert to LocationResult format
      setSelectedLocation({
        id: prefilledMunicipalityId,
        osmId: 0,
        osmType: "relation",
        name: prefilledMunicipalityName,
        nameFi: null,
        nameSv: null,
        nameEn: null,
        displayName: prefilledMunicipalityName,
        type: "municipality",
        adminLevel: 7,
        country,
        latitude: 0,
        longitude: 0,
        bounds: null,
        population: null,
        status: "active",
        contentCount: 0,
        parent: null,
      });
      setScope("local");
    }
  }, [prefilledLocation, prefilledMunicipalityId, prefilledMunicipalityName]);

  const handleScopeChange = (newScope: Scope) => {
    setScope(newScope);
    // Clear location if switching to european
    if (newScope === "european") {
      setSelectedLocation(null);
    }
  };

  const handleTagToggle = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const handleAddCustomTag = () => {
    const tag = customTag.trim().toLowerCase();
    if (tag && !selectedTags.includes(tag)) {
      setSelectedTags((prev) => [...prev, tag]);
      setCustomTag("");
    }
  };

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) {
      setError(t("threadForm.validationRequired"));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Build location data based on selected location status
      const locationData =
        scope === "local" && selectedLocation
          ? selectedLocation.status === "active" && selectedLocation.id
            ? { locationId: selectedLocation.id }
            : {
                locationOsmId: selectedLocation.osmId,
                locationOsmType: selectedLocation.osmType,
              }
          : {};

      const result = await createThreadMutation.mutateAsync({
        title: title.trim(),
        content: content.trim(),
        scope,
        country,
        ...locationData,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
      });

      onSuccess(result.id);
      handleClose();
    } catch (err) {
      setError(t("threadForm.createError"));
      console.error("Failed to create thread:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setTitle("");
    setContent("");
    setScope("local");
    setCountryDropdownOpen(false);
    setSelectedTags([]);
    setCustomTag("");
    setError(null);
    if (!prefilledMunicipalityId && !prefilledLocation) {
      setSelectedLocation(null);
    }
    onClose();
  };

  if (!isOpen) return null;

  const isPrefilled = !!(prefilledMunicipalityId || prefilledLocation);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-thread-title"
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-800">
          <h2
            id="new-thread-title"
            className="text-lg font-semibold text-gray-900 dark:text-gray-100"
          >
            {t("threadForm.collapsed")}
          </h2>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
            aria-label={t("common:actions.close")}
          >
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Show location badge when prefilled */}
          {isPrefilled && selectedLocation && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
              <MapPin className="w-4 h-4 text-blue-600" />
              <span className="text-blue-700 font-medium">
                {selectedLocation.name}
              </span>
            </div>
          )}

          {/* Scope selection - only show when not prefilled */}
          {!isPrefilled && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t("threadForm.scopeLabel")}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {scopeOptions.map(
                  ({ value, icon: Icon, label, description }) => (
                    <button
                      key={value}
                      onClick={() => handleScopeChange(value)}
                      className={`flex flex-col items-center p-3 rounded-xl border-2 transition-all ${
                        scope === value
                          ? "border-blue-600 bg-blue-50"
                          : "border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-600"
                      }`}
                    >
                      <Icon
                        className={`w-6 h-6 mb-1 ${scope === value ? "text-blue-600" : "text-gray-500 dark:text-gray-400"}`}
                      />
                      <span
                        className={`text-sm font-medium ${scope === value ? "text-blue-700" : "text-gray-700 dark:text-gray-300"}`}
                      >
                        {label}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 text-center mt-0.5">
                        {description}
                      </span>
                    </button>
                  ),
                )}
              </div>
            </div>
          )}

          {/* Location field (for local and national) - only show when not prefilled */}
          {!isPrefilled && scope !== "european" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {scope === "local"
                  ? t("threadForm.locationLabel")
                  : t("threadForm.countryLabel")}
              </label>
              {scope === "local" ? (
                <>
                  <div className="relative mb-2">
                    <button
                      type="button"
                      onClick={() => setCountryDropdownOpen((prev) => !prev)}
                      className="flex items-center justify-between w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-800 rounded-lg hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg">
                          {
                            SUPPORTED_COUNTRIES.find((c) => c.code === country)
                              ?.flag
                          }
                        </span>
                        <span className="text-gray-700 dark:text-gray-300">
                          {
                            SUPPORTED_COUNTRIES.find((c) => c.code === country)
                              ?.name
                          }
                        </span>
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform ${countryDropdownOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                    {countryDropdownOpen && (
                      <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {SUPPORTED_COUNTRIES.map((c) => (
                          <button
                            key={c.code}
                            type="button"
                            onClick={() => {
                              setCountry(c.code);
                              setCountryDropdownOpen(false);
                              setSelectedLocation(null);
                            }}
                            className={`flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                              country === c.code
                                ? "bg-blue-50 text-blue-700"
                                : "text-gray-700 dark:text-gray-300"
                            }`}
                          >
                            <span className="text-lg">{c.flag}</span>
                            <span>{c.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <LocationSearch
                    value={selectedLocation}
                    onChange={setSelectedLocation}
                    country={country}
                    types={["municipality", "village", "city"]}
                    placeholder={t("threadForm.locationPlaceholder")}
                  />
                </>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setCountryDropdownOpen((prev) => !prev)}
                    className="flex items-center justify-between w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-800 rounded-lg hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">
                        {
                          SUPPORTED_COUNTRIES.find((c) => c.code === country)
                            ?.flag
                        }
                      </span>
                      <span className="text-gray-700 dark:text-gray-300">
                        {
                          SUPPORTED_COUNTRIES.find((c) => c.code === country)
                            ?.name
                        }
                      </span>
                    </div>
                    <ChevronDown
                      className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform ${countryDropdownOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {countryDropdownOpen && (
                    <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {SUPPORTED_COUNTRIES.map((c) => (
                        <button
                          key={c.code}
                          type="button"
                          onClick={() => {
                            setCountry(c.code);
                            setCountryDropdownOpen(false);
                          }}
                          className={`flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                            country === c.code
                              ? "bg-blue-50 text-blue-700"
                              : "text-gray-700 dark:text-gray-300"
                          }`}
                        >
                          <span className="text-lg">{c.flag}</span>
                          <span>{c.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t("threadForm.title")}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("threadForm.collapsed")}
              className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-800 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              maxLength={500}
            />
            <div className="mt-1 text-xs text-gray-400 dark:text-gray-500 text-right">
              {title.length}/500
            </div>
          </div>

          {/* Content */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t("threadForm.content")}
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t("threadForm.contentPlaceholder")}
              rows={5}
              className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-800 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
            <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {t("threadForm.markdown")}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t("threadForm.tagsLabel")}
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {suggestedTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => handleTagToggle(tag)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    selectedTags.includes(tag)
                      ? "bg-teal-600 text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  <Hash className="w-3 h-3" />
                  {tag}
                </button>
              ))}
            </div>
            {/* Custom tag input */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customTag}
                onChange={(e) => setCustomTag(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  (e.preventDefault(), handleAddCustomTag())
                }
                placeholder={t("threadForm.customTag")}
                className="flex-1 px-3 py-1.5 border border-gray-200 dark:border-gray-800 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={handleAddCustomTag}
                disabled={!customTag.trim()}
                className="p-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
              >
                <Plus className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              </button>
            </div>
            {/* Selected custom tags */}
            {selectedTags.filter((t) => !suggestedTags.includes(t)).length >
              0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {selectedTags
                  .filter((t) => !suggestedTags.includes(t))
                  .map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-teal-600 text-white rounded-full text-xs"
                    >
                      <Hash className="w-3 h-3" />
                      {tag}
                      <button
                        onClick={() => handleTagToggle(tag)}
                        className="ml-0.5 hover:bg-teal-700 rounded-full p-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
              </div>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 font-medium transition-colors"
          >
            {t("threadForm.cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || !content.trim() || isSubmitting}
            className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isSubmitting
              ? t("threadForm.publishing")
              : t("threadForm.publish")}
          </button>
        </div>
      </div>
    </div>
  );
}
