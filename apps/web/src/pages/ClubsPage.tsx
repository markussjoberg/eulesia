import { useState, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  Plus,
  X,
  Globe,
  Lock,
  Image as ImageIcon,
  Loader2,
  Trash2,
  Mail,
  Check,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import { ClubCard } from "../components/clubs";
import {
  ContentEndMarker,
  LocationSearch,
  ErrorState,
} from "../components/common";
import {
  useClubs,
  useClubCategories,
  useCreateClub,
  useMyClubInvitations,
  useAcceptClubInvitation,
  useDeclineClubInvitation,
} from "../hooks/useApi";
import { useAuth } from "../hooks/useAuth";

import { api } from "../lib/api";
import type { Club as ApiClub, LocationResult } from "../lib/api";

// Transform API club to component format
function transformClub(club: ApiClub) {
  return club;
}

export function ClubsPage() {
  const { t } = useTranslation("clubs");
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Create form state
  const [newClubName, setNewClubName] = useState("");
  const [newClubDescription, setNewClubDescription] = useState("");
  const [newClubCategory, setNewClubCategory] = useState("");
  const [newClubIsPublic, setNewClubIsPublic] = useState(true);
  const [newClubCoverImage, setNewClubCoverImage] = useState<string | null>(
    null,
  );
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [newClubLocation, setNewClubLocation] = useState<LocationResult | null>(
    null,
  );
  const [newClubRules, setNewClubRules] = useState<string[]>([]);
  const [newRuleInput, setNewRuleInput] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);

  const { data: categoriesData } = useClubCategories();
  const createClubMutation = useCreateClub();
  const {
    data: clubsData,
    isLoading,
    error,
    refetch,
  } = useClubs({
    category: selectedCategory || undefined,
    search: searchQuery || undefined,
  });
  const { data: myClubsData } = useClubs({ membership: "mine" });
  const { data: clubInvitations } = useMyClubInvitations();
  const acceptInvitationMutation = useAcceptClubInvitation();
  const declineInvitationMutation = useDeclineClubInvitation();

  const categories = useMemo(() => {
    return categoriesData?.map((c) => c.category) || [];
  }, [categoriesData]);

  const clubs = useMemo(() => {
    if (!clubsData?.items) return [];
    return clubsData.items.map(transformClub);
  }, [clubsData]);

  const myClubs = useMemo(() => {
    if (!myClubsData?.items) return [];
    return myClubsData.items.map(transformClub);
  }, [myClubsData]);

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) return;
    if (file.size > 5 * 1024 * 1024) return;

    setIsUploadingImage(true);
    try {
      const result = await api.uploadImage(file);
      setNewClubCoverImage(result.url);
    } catch (err) {
      console.error("Image upload failed:", err);
    } finally {
      setIsUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const handleAddRule = () => {
    const rule = newRuleInput.trim();
    if (rule && newClubRules.length < 10) {
      setNewClubRules((prev) => [...prev, rule]);
      setNewRuleInput("");
    }
  };

  const handleRemoveRule = (index: number) => {
    setNewClubRules((prev) => prev.filter((_, i) => i !== index));
  };

  const resetForm = () => {
    setNewClubName("");
    setNewClubDescription("");
    setNewClubCategory("");
    setNewClubIsPublic(true);
    setNewClubCoverImage(null);
    setNewClubLocation(null);
    setNewClubRules([]);
    setNewRuleInput("");
    setCustomCategory("");
  };

  const handleCreateClub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClubName.trim()) return;

    const slug = generateSlug(newClubName.trim());
    if (slug.length < 3) return;

    try {
      const club = await createClubMutation.mutateAsync({
        name: newClubName.trim(),
        slug,
        description: newClubDescription.trim() || undefined,
        category:
          (newClubCategory === "__other__"
            ? customCategory.trim()
            : newClubCategory.trim()) || undefined,
        coverImageUrl: newClubCoverImage || undefined,
        isPublic: newClubIsPublic,
        latitude: newClubLocation?.coordinates?.latitude ?? undefined,
        longitude: newClubLocation?.coordinates?.longitude ?? undefined,
        address: newClubLocation
          ? newClubLocation.displayName || newClubLocation.name
          : undefined,
        rules: newClubRules.length > 0 ? newClubRules : undefined,
      });
      resetForm();
      setShowCreateForm(false);
      navigate(`/clubs/${club.id}`);
    } catch (err) {
      console.error("Failed to create club:", err);
    }
  };

  return (
    <Layout>
      <SEOHead
        title={t("title")}
        description={t("subtitle")}
        path="/clubs"
        noIndex
      />
      {/* Page header */}
      <div
        className="bg-white dark:bg-gray-900 px-4 py-4 border-b border-gray-200 dark:border-gray-800"
        data-guide="clubs-header"
      >
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {t("title")}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {t("subtitle")}
            </p>
          </div>
          {currentUser && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
              data-guide="clubs-create"
            >
              <Plus className="w-4 h-4" />
              {t("newClub")}
            </button>
          )}
        </div>
      </div>

      {/* Create Club Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-lg max-h-[90dvh] flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between flex-shrink-0">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                {t("create.title")}
              </h3>
              <button
                onClick={() => {
                  setShowCreateForm(false);
                  resetForm();
                }}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              >
                <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              </button>
            </div>
            <form
              id="create-club-form"
              onSubmit={handleCreateClub}
              className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0"
            >
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("create.name")} *
                </label>
                <input
                  type="text"
                  value={newClubName}
                  onChange={(e) => setNewClubName(e.target.value)}
                  placeholder={t("create.namePlaceholder")}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                  required
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("create.description")}
                </label>
                <textarea
                  value={newClubDescription}
                  onChange={(e) => setNewClubDescription(e.target.value)}
                  placeholder={t("create.descriptionPlaceholder")}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none dark:bg-gray-800 dark:text-gray-100"
                />
              </div>

              {/* Category — dropdown */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("create.category")}
                </label>
                <select
                  value={newClubCategory}
                  onChange={(e) => setNewClubCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">{t("create.selectCategory")}</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                  <option value="__other__">{t("create.otherCategory")}</option>
                </select>
                {newClubCategory === "__other__" && (
                  <input
                    type="text"
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    placeholder={t("create.categoryPlaceholder")}
                    className="w-full mt-2 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                  />
                )}
              </div>

              {/* Cover Image */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("create.coverImage")}
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  {t("create.coverImageHint")}
                </p>
                {newClubCoverImage ? (
                  <div className="relative">
                    <img
                      src={newClubCoverImage}
                      alt=""
                      className="w-full h-32 object-cover rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => setNewClubCoverImage(null)}
                      className="absolute top-2 right-2 p-1 bg-black/50 rounded-full hover:bg-black/70"
                    >
                      <X className="w-4 h-4 text-white" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={isUploadingImage}
                    className="w-full h-24 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400 hover:border-teal-400 hover:text-teal-600 transition-colors disabled:opacity-50"
                  >
                    {isUploadingImage ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span className="text-sm">
                          {t("create.uploadingImage")}
                        </span>
                      </>
                    ) : (
                      <>
                        <ImageIcon className="w-5 h-5" />
                        <span className="text-sm">
                          {t("create.coverImage")}
                        </span>
                      </>
                    )}
                  </button>
                )}
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </div>

              {/* Location */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("create.location")}
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  {t("create.locationHint")}
                </p>
                <LocationSearch
                  value={newClubLocation}
                  onChange={setNewClubLocation}
                />
              </div>

              {/* Visibility — Open/Closed radio */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t("create.visibility")}
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="clubVisibility"
                      checked={newClubIsPublic}
                      onChange={() => setNewClubIsPublic(true)}
                      className="text-teal-600"
                    />
                    <Globe className="w-4 h-4 text-green-600" />
                    <div>
                      <span className="text-sm font-medium">
                        {t("create.open")}
                      </span>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t("create.openHint")}
                      </p>
                    </div>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="clubVisibility"
                      checked={!newClubIsPublic}
                      onChange={() => setNewClubIsPublic(false)}
                      className="text-teal-600"
                    />
                    <Lock className="w-4 h-4 text-amber-600" />
                    <div>
                      <span className="text-sm font-medium">
                        {t("create.closed")}
                      </span>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t("create.closedHint")}
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Rules */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("create.rules")}
                </label>
                {newClubRules.length > 0 && (
                  <ol className="space-y-1 mb-2">
                    {newClubRules.map((rule, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2 text-sm bg-gray-50 dark:bg-gray-800/50 px-3 py-1.5 rounded-lg"
                      >
                        <span className="text-gray-400 dark:text-gray-500 font-medium">
                          {i + 1}.
                        </span>
                        <span className="flex-1 text-gray-700 dark:text-gray-300">
                          {rule}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveRule(i)}
                          className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                {newClubRules.length < 10 && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newRuleInput}
                      onChange={(e) => setNewRuleInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddRule();
                        }
                      }}
                      placeholder={t("create.rulePlaceholder")}
                      className="flex-1 px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                    />
                    <button
                      type="button"
                      onClick={handleAddRule}
                      disabled={!newRuleInput.trim()}
                      className="px-3 py-1.5 text-sm text-teal-600 hover:bg-teal-50 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t("create.addRule")}
                    </button>
                  </div>
                )}
              </div>
            </form>
            {/* Actions - fixed footer always visible on mobile */}
            <div className="flex gap-2 p-4 border-t border-gray-200 dark:border-gray-800 flex-shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm(false);
                  resetForm();
                }}
                className="flex-1 px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                {t("common:actions.cancel")}
              </button>
              <button
                type="submit"
                form="create-club-form"
                disabled={
                  createClubMutation.isPending ||
                  !newClubName.trim() ||
                  generateSlug(newClubName.trim()).length < 3
                }
                className="flex-1 bg-teal-600 text-white py-2 rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {createClubMutation.isPending
                  ? t("create.creating")
                  : t("create.create")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search and filters */}
      <div
        className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3 sticky top-14 z-40"
        data-guide="clubs-search"
      >
        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            placeholder={t("search")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 dark:text-gray-100"
          />
        </div>

        {/* Category filters */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              selectedCategory === null
                ? "bg-teal-600 text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {t("allCategories")}
          </button>
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                selectedCategory === category
                  ? "bg-teal-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      {/* My Clubs section */}
      {myClubs.length > 0 && !searchQuery && !selectedCategory && (
        <div className="px-4 pt-4 pb-2">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            {t("myClubs")}
          </h2>
          <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2">
            {myClubs.map((club) => (
              <button
                key={club.id}
                onClick={() => navigate(`/clubs/${club.id}`)}
                className="flex-shrink-0 w-28 text-center"
              >
                {club.coverImageUrl ? (
                  <img
                    src={club.coverImageUrl}
                    alt=""
                    className="w-16 h-16 rounded-xl object-cover mx-auto"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 mx-auto flex items-center justify-center text-white font-bold text-lg">
                    {club.name.charAt(0)}
                  </div>
                )}
                <div className="mt-1.5 text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                  {club.name}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pending Club Invitations */}
      {clubInvitations && clubInvitations.length > 0 && (
        <div className="px-4 pt-4 pb-2">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
            <Mail className="w-4 h-4" />
            {t("clubInvitations")}
          </h2>
          <div className="space-y-2">
            {clubInvitations.map((inv) => (
              <div
                key={inv.id}
                className="bg-white dark:bg-gray-900 rounded-xl border border-amber-200 dark:border-amber-800 p-3 flex items-center gap-3"
              >
                {inv.club?.coverImageUrl ? (
                  <img
                    src={inv.club.coverImageUrl}
                    alt=""
                    className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                    {(inv.club?.name ?? inv.clubName ?? "?").charAt(0)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate">
                    {inv.club?.name ?? inv.clubName ?? ""}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t("invitedBy", { name: inv.inviter?.name ?? "" })}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => acceptInvitationMutation.mutate(inv.id)}
                    disabled={
                      acceptInvitationMutation.isPending ||
                      declineInvitationMutation.isPending
                    }
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-teal-600 text-white text-xs font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {t("acceptInvite")}
                  </button>
                  <button
                    onClick={() => declineInvitationMutation.mutate(inv.id)}
                    disabled={
                      acceptInvitationMutation.isPending ||
                      declineInvitationMutation.isPending
                    }
                    className="px-2.5 py-1.5 text-gray-500 dark:text-gray-400 text-xs font-medium rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
                  >
                    {t("declineInvite")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Club list */}
      <div className="px-4 py-4">
        {isLoading && (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <ErrorState
            title={t("failedToLoad")}
            description={error instanceof Error ? error.message : undefined}
            onRetry={() => refetch()}
          />
        )}

        {!isLoading && !error && clubs.length > 0 && (
          <div className="space-y-3">
            {clubs.map((club, index) => (
              <div
                key={club.id}
                {...(index === 0 ? { "data-guide": "clubs-clubcard" } : {})}
              >
                <ClubCard club={club} />
              </div>
            ))}
          </div>
        )}

        {!isLoading && !error && clubs.length === 0 && (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            <p>{t("noClubs")}</p>
            <button
              onClick={() => {
                setSearchQuery("");
                setSelectedCategory(null);
              }}
              className="mt-2 text-teal-600 hover:underline text-sm"
            >
              {t("clearFilters")}
            </button>
          </div>
        )}

        {!isLoading && clubs.length > 0 && (
          <ContentEndMarker message={t("allClubsShown")} />
        )}
      </div>
    </Layout>
  );
}
