import { useState } from "react";
import { Link } from "react-router-dom";
import {
  MapPin,
  Hash,
  Building2,
  CheckCircle2,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useSubscribe,
  useMunicipalities,
  useTags,
  useUpdateProfile,
} from "../../hooks/useApi";
import type { Municipality, TagWithCategory } from "../../lib/api";

interface FeedOnboardingProps {
  onComplete: () => void;
  compact?: boolean;
}

function groupTagsByCategory(
  tags: TagWithCategory[],
): Record<string, TagWithCategory[]> {
  const groups: Record<string, TagWithCategory[]> = {};
  for (const tag of tags) {
    const category = tag.category || "muut";
    if (!groups[category]) groups[category] = [];
    groups[category].push(tag);
  }
  return groups;
}

export function FeedOnboarding({
  onComplete,
  compact = false,
}: FeedOnboardingProps) {
  const { t } = useTranslation(["agora", "common"]);
  const [homeMunicipalityId, setHomeMunicipalityId] = useState<string | null>(
    null,
  );
  const [selectedMunicipalities, setSelectedMunicipalities] = useState<
    string[]
  >([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: municipalitiesData } = useMunicipalities();
  const { data: tagsData } = useTags();
  const subscribeMutation = useSubscribe();
  const updateProfileMutation = useUpdateProfile();

  const topMunicipalities = (municipalitiesData || []).slice(0, 8);

  // Group tags by category, show top tags from each category
  const allTags = tagsData || [];
  const grouped = groupTagsByCategory(allTags);
  const categories = Object.keys(grouped).filter((c) => c !== "muut");

  // Show top 2-3 tags per category for compact onboarding
  const featuredTags: TagWithCategory[] = [];
  for (const category of categories) {
    const categoryTags = grouped[category] || [];
    // Take tags with highest count or first by sort order
    const sorted = [...categoryTags].sort(
      (a, b) => (b.count || 0) - (a.count || 0),
    );
    featuredTags.push(...sorted.slice(0, 2));
  }

  const toggleMunicipality = (id: string) => {
    setSelectedMunicipalities((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  };

  const toggleHomeMunicipality = (id: string) => {
    setHomeMunicipalityId((prev) => (prev === id ? null : id));
    setSelectedMunicipalities((prev) =>
      prev.filter((municipality) => municipality !== id),
    );
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);

    try {
      if (homeMunicipalityId) {
        await updateProfileMutation.mutateAsync({
          municipalityId: homeMunicipalityId,
        });
      }

      // Subscribe to selected municipalities except the home municipality,
      // which the backend auto-follows when set.
      for (const municipalityId of selectedMunicipalities) {
        await subscribeMutation.mutateAsync({
          entityType: "municipality",
          entityId: municipalityId,
        });
      }

      // Subscribe to selected tags
      for (const tag of selectedTags) {
        await subscribeMutation.mutateAsync({
          entityType: "tag",
          entityId: tag,
        });
      }

      onComplete();
    } catch (error) {
      console.error("Failed to save subscriptions:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasSelections =
    homeMunicipalityId !== null ||
    selectedMunicipalities.length > 0 ||
    selectedTags.length > 0;

  // Compact inline banner mode for Tutustu tab
  if (compact) {
    return (
      <div className="bg-gradient-to-r from-blue-50 to-teal-50 dark:from-blue-900/20 dark:to-teal-900/20 rounded-xl border border-blue-200 dark:border-blue-800 p-4 mb-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 bg-blue-100 dark:bg-blue-900/40 rounded-full flex items-center justify-center">
            <MapPin className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
              {t("agora:onboarding.compactTitle", {
                defaultValue: "Seuraa aiheita saadaksesi oman syötteen",
              })}
            </h3>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {topMunicipalities.slice(0, 4).map((m: Municipality) => (
                <button
                  key={m.id}
                  onClick={() => toggleHomeMunicipality(m.id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    homeMunicipalityId === m.id
                      ? "bg-blue-600 text-white"
                      : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100"
                  }`}
                >
                  {homeMunicipalityId === m.id && "✓ "}
                  {m.name}
                </button>
              ))}
              {featuredTags.slice(0, 4).map((tag) => (
                <button
                  key={tag.tag}
                  onClick={() => toggleTag(tag.tag)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    selectedTags.includes(tag.tag)
                      ? "bg-teal-600 text-white"
                      : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100"
                  }`}
                >
                  {selectedTags.includes(tag.tag) && "✓ "}
                  {tag.displayName || tag.tag.replace(/-/g, " ")}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-3">
              {hasSelections && (
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : null}
                  {t("agora:onboarding.ready", { defaultValue: "Valmis" })}
                </button>
              )}
              <button
                onClick={onComplete}
                className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                {t("common:actions.dismiss", { defaultValue: "Piilota" })}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 max-w-lg mx-auto">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
          <svg
            className="w-8 h-8 text-blue-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
            />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          {t("agora:onboarding.welcome")}
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          {t("agora:onboarding.emptyFeed")}
        </p>
      </div>

      {/* Municipalities */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <MapPin className="w-5 h-5 text-blue-600" />
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">
            {t("agora:onboarding.municipalities", {
              defaultValue: "Kotikunta",
            })}
          </h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {topMunicipalities.map((m: Municipality) => (
            <button
              key={m.id}
              onClick={() => toggleHomeMunicipality(m.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                homeMunicipalityId === m.id
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {homeMunicipalityId === m.id && (
                <CheckCircle2 className="w-4 h-4" />
              )}
              {m.name}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="w-5 h-5 text-blue-600" />
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">
            {t("agora:onboarding.followMoreMunicipalities", {
              defaultValue: "Seuraa myös muita kuntia",
            })}
          </h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {topMunicipalities
            .filter(
              (municipality: Municipality) =>
                municipality.id !== homeMunicipalityId,
            )
            .map((m: Municipality) => (
              <button
                key={m.id}
                onClick={() => toggleMunicipality(m.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  selectedMunicipalities.includes(m.id)
                    ? "bg-sky-600 text-white"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {selectedMunicipalities.includes(m.id) && (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                {m.name}
              </button>
            ))}
        </div>
      </div>

      {/* Tags by category */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Hash className="w-5 h-5 text-teal-600" />
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
              {t("agora:onboarding.topics")}
            </h3>
          </div>
          <Link
            to="/aiheet"
            className="text-xs text-teal-600 hover:underline flex items-center gap-0.5"
          >
            {t("agora:onboarding.allTopics")}
            <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        {/* Featured tags from each category */}
        <div className="flex flex-wrap gap-2">
          {featuredTags.map((tag) => (
            <button
              key={tag.tag}
              onClick={() => toggleTag(tag.tag)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                selectedTags.includes(tag.tag)
                  ? "bg-teal-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {selectedTags.includes(tag.tag) && (
                <CheckCircle2 className="w-4 h-4" />
              )}
              {tag.displayName || tag.tag.replace(/-/g, " ")}
            </button>
          ))}
        </div>
      </div>

      {/* Organizations hint */}
      <div className="mb-6 p-3 bg-violet-50 rounded-lg">
        <div className="flex items-start gap-2">
          <Building2 className="w-5 h-5 text-violet-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-violet-700">
            {t("agora:onboarding.institutionHint")}
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={onComplete}
          className="flex-1 px-4 py-2.5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg font-medium transition-colors"
        >
          {t("common:actions.skip")}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!hasSelections || isSubmitting}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("common:actions.saving")}
            </>
          ) : (
            t("agora:onboarding.ready")
          )}
        </button>
      </div>
    </div>
  );
}
