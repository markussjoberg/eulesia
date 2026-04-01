import { useState, useCallback } from "react";
import { MapPin, Hash, Users, ChevronRight, CheckCircle2, Loader2, Search, UserPlus, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useSubscribe,
  useTags,
  useSearchUsers,
  useCompleteOnboarding,
} from "../../hooks/useApi";
import { LocationSearch } from "../common/LocationSearch";
import type { TagWithCategory, LocationResult } from "../../lib/api";

type Step = "municipality" | "tags" | "friends";

interface OnboardingWizardProps {
  onComplete: () => void;
}

function groupTagsByCategory(tags: TagWithCategory[]): Record<string, TagWithCategory[]> {
  const groups: Record<string, TagWithCategory[]> = {};
  for (const tag of tags) {
    const category = tag.category || "muut";
    if (!groups[category]) groups[category] = [];
    groups[category].push(tag);
  }
  return groups;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { t } = useTranslation(["agora", "common"]);
  const [step, setStep] = useState<Step>("municipality");
  const [selectedLocation, setSelectedLocation] = useState<LocationResult | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [followedUsers, setFollowedUsers] = useState<string[]>([]);
  const [friendSearch, setFriendSearch] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: tagsData } = useTags();
  const { data: searchResults } = useSearchUsers(friendSearch.length >= 2 ? friendSearch : "");
  const subscribeMutation = useSubscribe();
  const completeOnboardingMutation = useCompleteOnboarding();

  const allTags = tagsData || [];
  const grouped = groupTagsByCategory(allTags);
  const categories = Object.keys(grouped).filter((c) => c !== "muut");
  const featuredTags: TagWithCategory[] = [];
  for (const category of categories) {
    const sorted = [...(grouped[category] || [])].sort((a, b) => (b.count || 0) - (a.count || 0));
    featuredTags.push(...sorted.slice(0, 3));
  }

  const steps: Step[] = ["municipality", "tags", "friends"];
  const stepIndex = steps.indexOf(step);

  const handleFinish = useCallback(async () => {
    setIsSubmitting(true);
    try {
      // Subscribe to selections — errors are non-fatal
      if (selectedLocation?.id) {
        await subscribeMutation.mutateAsync({ entityType: "municipality", entityId: selectedLocation.id }).catch(() => {});
      }
      for (const tag of selectedTags) {
        await subscribeMutation.mutateAsync({ entityType: "tag", entityId: tag }).catch(() => {});
      }
      for (const userId of followedUsers) {
        await subscribeMutation.mutateAsync({ entityType: "user", entityId: userId }).catch(() => {});
      }
    } catch (err) {
      console.error("Onboarding subscriptions failed", err);
    }
    // Always complete onboarding and close wizard
    completeOnboardingMutation.mutate();
    onComplete();
    setIsSubmitting(false);
  }, [selectedLocation, selectedTags, followedUsers, subscribeMutation, completeOnboardingMutation, onComplete]);

  const stepTitles: Record<Step, string> = {
    municipality: t("agora:onboarding.stepMunicipality", { defaultValue: "Kotikuntasi" }),
    tags: t("agora:onboarding.stepTags", { defaultValue: "Kiinnostavat aiheet" }),
    friends: t("agora:onboarding.stepFriends", { defaultValue: "Etsi kavereita" }),
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-900 w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl flex flex-col max-h-[90vh]">
        {/* Progress bar */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2 mb-4">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  i < stepIndex ? "bg-blue-600 text-white" :
                  i === stepIndex ? "bg-blue-600 text-white" :
                  "bg-gray-100 dark:bg-gray-800 text-gray-400"
                }`}>
                  {i < stepIndex ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                {i < steps.length - 1 && (
                  <div className={`flex-1 h-0.5 transition-colors ${i < stepIndex ? "bg-blue-600" : "bg-gray-100 dark:bg-gray-800"}`} />
                )}
              </div>
            ))}
          </div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {stepTitles[step]}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {step === "municipality" && t("agora:onboarding.municipalityHint", { defaultValue: "Valitse kotikuntasi — saat paikallisen syötteen." })}
            {step === "tags" && t("agora:onboarding.tagsHint", { defaultValue: "Seuraa aiheita jotka kiinnostavat sinua." })}
            {step === "friends" && t("agora:onboarding.friendsHint", { defaultValue: "Etsi kavereita nimellä." })}
          </p>
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {step === "municipality" && (
            <div className="min-h-[320px]">
              <LocationSearch
                value={selectedLocation}
                onChange={setSelectedLocation}
                placeholder={t("agora:onboarding.municipalitySearchPlaceholder", { defaultValue: "Hae kuntaa tai kaupunkia..." })}
              />
              {selectedLocation && !selectedLocation.id && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  {t("agora:onboarding.locationNotInDb", { defaultValue: "Tätä paikkakuntaa ei vielä löydy sisällöstä — voit silti valita sen." })}
                </p>
              )}
              {selectedLocation && (
                <div className="mt-3 flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
                  <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{selectedLocation.name}</p>
                    {selectedLocation.parent && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">{selectedLocation.parent.name}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "tags" && (
            <div>
              <div className="flex flex-wrap gap-2">
                {featuredTags.map((tag) => (
                  <button
                    key={tag.tag}
                    onClick={() => setSelectedTags((prev) =>
                      prev.includes(tag.tag) ? prev.filter((t) => t !== tag.tag) : [...prev, tag.tag]
                    )}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                      selectedTags.includes(tag.tag)
                        ? "bg-teal-600 text-white"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    {selectedTags.includes(tag.tag) && <CheckCircle2 className="w-4 h-4" />}
                    <Hash className="w-3 h-3 opacity-60" />
                    {tag.displayName || tag.tag.replace(/-/g, " ")}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === "friends" && (
            <div>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={friendSearch}
                  onChange={(e) => setFriendSearch(e.target.value)}
                  placeholder={t("agora:onboarding.friendSearchPlaceholder", { defaultValue: "Kirjoita nimi..." })}
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100"
                  autoFocus
                />
              </div>
              {friendSearch.length >= 2 && searchResults && (
                <div className="space-y-2">
                  {searchResults.filter((u) => u.role === "citizen").map((user) => (
                    <div key={user.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-800">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-sm font-semibold text-blue-700 dark:text-blue-300">
                          {user.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{user.name}</p>
                          {user.municipalityName && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                              <MapPin className="w-3 h-3" />{user.municipalityName}
                            </p>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => setFollowedUsers((prev) =>
                          prev.includes(user.id) ? prev.filter((id) => id !== user.id) : [...prev, user.id]
                        )}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          followedUsers.includes(user.id)
                            ? "bg-blue-600 text-white"
                            : "bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        {followedUsers.includes(user.id) ? <Check className="w-3 h-3" /> : <UserPlus className="w-3 h-3" />}
                        {followedUsers.includes(user.id)
                          ? t("common:actions.following", { defaultValue: "Seurataan" })
                          : t("common:actions.follow", { defaultValue: "Seuraa" })}
                      </button>
                    </div>
                  ))}
                  {searchResults.filter((u) => u.role === "citizen").length === 0 && (
                    <p className="text-center text-sm text-gray-500 py-4">
                      {t("agora:onboarding.noFriendsFound", { defaultValue: "Ei tuloksia nimellä \"" })}"{friendSearch}"
                    </p>
                  )}
                </div>
              )}
              {friendSearch.length < 2 && (
                <p className="text-center text-sm text-gray-400 py-8">
                  {t("agora:onboarding.friendSearchMin", { defaultValue: "Kirjoita vähintään 2 merkkiä" })}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex gap-3">
          {step !== "municipality" && (
            <button
              onClick={() => setStep(steps[stepIndex - 1])}
              className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl font-medium transition-colors"
            >
              {t("common:actions.back", { defaultValue: "Takaisin" })}
            </button>
          )}
          <div className="flex-1" />
          {step !== "friends" ? (
            <>
              {step !== "municipality" && (
                <button
                  onClick={() => setStep(steps[stepIndex + 1])}
                  className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 font-medium transition-colors"
                >
                  {t("common:actions.skip", { defaultValue: "Ohita" })}
                </button>
              )}
              <button
                onClick={() => setStep(steps[stepIndex + 1])}
                disabled={step === "municipality" && !selectedLocation}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {t("common:actions.continue", { defaultValue: "Jatka" })}
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleFinish}
                disabled={isSubmitting}
                className="flex items-center gap-1.5 px-5 py-2.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 font-medium transition-colors"
              >
                {t("common:actions.skip", { defaultValue: "Ohita" })}
              </button>
              <button
                onClick={handleFinish}
                disabled={isSubmitting}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                {t("agora:onboarding.ready", { defaultValue: "Valmis" })}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
