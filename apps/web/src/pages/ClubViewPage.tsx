import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Users,
  Shield,
  MessageSquare,
  Pin,
  ScrollText,
  X,
  Send,
  Settings,
  Globe,
  Lock,
  MapPin,
  Image as ImageIcon,
  Loader2,
  Trash2,
  MoreVertical,
  UserMinus,
  UserPlus,
  Mail,
} from "lucide-react";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import {
  ActorBadge,
  ContentEndMarker,
  FollowButton,
  LocationSearch,
  ReportButton,
} from "../components/common";
import {
  useClub,
  useClubCategories,
  useJoinClub,
  useLeaveClub,
  useCreateClubThread,
  useUpdateClub,
  useDeleteClub,
  useUpdateMemberRole,
  useRemoveMember,
  useClubInvitations,
  useInviteToClub,
  useCancelClubInvitation,
  useSearchUsers,
} from "../hooks/useApi";
import { api } from "../lib/api";
import { formatRelativeTime } from "../lib/formatTime";
import type { ClubThread, ClubMember, LocationResult } from "../lib/api";
import { getAvatarInitials } from "../utils/avatar";

export function ClubViewPage() {
  const { t } = useTranslation("clubs");
  const navigate = useNavigate();
  const { clubId } = useParams<{ clubId: string }>();
  const { data: club, isLoading, error } = useClub(clubId || "");
  const joinClubMutation = useJoinClub();
  const leaveClubMutation = useLeaveClub();
  const createThreadMutation = useCreateClubThread(clubId || "");
  const updateClubMutation = useUpdateClub(clubId || "");
  const deleteClubMutation = useDeleteClub();
  const updateRoleMutation = useUpdateMemberRole(clubId || "");
  const removeMemberMutation = useRemoveMember(clubId || "");
  const { data: categoriesData } = useClubCategories();
  const availableCategories = categoriesData?.map((c) => c.category) || [];
  const canManageInvitations =
    club?.memberRole === "owner" || club?.memberRole === "moderator";
  const { data: pendingInvitations } = useClubInvitations(
    clubId || "",
    canManageInvitations,
  );
  const inviteToClubMutation = useInviteToClub(clubId || "");
  const cancelInvitationMutation = useCancelClubInvitation(clubId || "");

  const [showNewThreadForm, setShowNewThreadForm] = useState(false);
  const [memberMenuOpen, setMemberMenuOpen] = useState<string | null>(null);
  const [confirmRemoveMember, setConfirmRemoveMember] =
    useState<ClubMember | null>(null);
  const [confirmDeleteClub, setConfirmDeleteClub] = useState(false);
  const [showMemberList, setShowMemberList] = useState(false);
  const [inviteSearch, setInviteSearch] = useState("");
  const { data: searchedUsers } = useSearchUsers(inviteSearch, 5);
  const [newThreadTitle, setNewThreadTitle] = useState("");
  const [newThreadContent, setNewThreadContent] = useState("");

  // Settings modal state
  const [showSettings, setShowSettings] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editIsPublic, setEditIsPublic] = useState(true);
  const [editCoverImage, setEditCoverImage] = useState<string | null>(null);
  const [editLocation, setEditLocation] = useState<LocationResult | null>(null);
  const [editAddress, setEditAddress] = useState("");
  const [editRules, setEditRules] = useState<string[]>([]);
  const [editRuleInput, setEditRuleInput] = useState("");
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const settingsImageRef = useRef<HTMLInputElement>(null);

  const openSettings = () => {
    if (!club) return;
    setEditName(club.name);
    setEditDescription(club.description || "");
    setEditCategory(club.category || "");
    setEditIsPublic(club.isPublic);
    setEditCoverImage(club.coverImageUrl || null);
    setEditAddress(club.address || "");
    setEditRules(() => {
      if (Array.isArray(club.rules)) return club.rules;
      if (typeof club.rules === "string") {
        try {
          const parsed = JSON.parse(club.rules);
          if (Array.isArray(parsed)) return parsed;
        } catch {
          /* not JSON */
        }
        return [club.rules];
      }
      return [];
    });
    setEditRuleInput("");
    setEditLocation(null);
    setShowSettings(true);
  };

  const handleSettingsImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type) || file.size > 5 * 1024 * 1024)
      return;
    setIsUploadingImage(true);
    try {
      const result = await api.uploadImage(file);
      setEditCoverImage(result.url);
    } catch (err) {
      console.error("Image upload failed:", err);
    } finally {
      setIsUploadingImage(false);
      if (settingsImageRef.current) settingsImageRef.current.value = "";
    }
  };

  const handleAddEditRule = () => {
    const rule = editRuleInput.trim();
    if (rule && editRules.length < 10) {
      setEditRules((prev) => [...prev, rule]);
      setEditRuleInput("");
    }
  };

  const handleSaveSettings = async () => {
    try {
      await updateClubMutation.mutateAsync({
        name: editName.trim(),
        description: editDescription.trim() || undefined,
        category: editCategory.trim() || undefined,
        coverImageUrl: editCoverImage || undefined,
        isPublic: editIsPublic,
        latitude: editLocation?.coordinates?.latitude ?? undefined,
        longitude: editLocation?.coordinates?.longitude ?? undefined,
        address: editLocation
          ? editLocation.displayName || editLocation.name
          : editAddress || undefined,
        rules: editRules.length > 0 ? editRules : undefined,
      });
      setShowSettings(false);
    } catch (err) {
      console.error("Failed to update club:", err);
    }
  };

  const handleChangeRole = async (userId: string, role: string) => {
    try {
      await updateRoleMutation.mutateAsync({ userId, role });
      setMemberMenuOpen(null);
    } catch (err) {
      console.error("Failed to change role:", err);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    try {
      await removeMemberMutation.mutateAsync(userId);
      setConfirmRemoveMember(null);
    } catch (err) {
      console.error("Failed to remove member:", err);
    }
  };

  const handleCreateThread = async () => {
    if (!newThreadTitle.trim() || !newThreadContent.trim()) return;
    try {
      await createThreadMutation.mutateAsync({
        title: newThreadTitle.trim(),
        content: newThreadContent.trim(),
      });
      setNewThreadTitle("");
      setNewThreadContent("");
      setShowNewThreadForm(false);
    } catch (err) {
      console.error("Failed to create thread:", err);
    }
  };

  const handleJoin = async () => {
    if (!clubId) return;
    try {
      await joinClubMutation.mutateAsync(clubId);
    } catch (err) {
      console.error("Failed to join club:", err);
    }
  };

  const handleInviteUser = async (userId: string) => {
    try {
      await inviteToClubMutation.mutateAsync(userId);
      setInviteSearch("");
    } catch (err) {
      console.error("Failed to invite user:", err);
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    try {
      await cancelInvitationMutation.mutateAsync(invitationId);
    } catch (err) {
      console.error("Failed to cancel invitation:", err);
    }
  };

  const handleDeleteClub = async () => {
    if (!clubId) return;
    try {
      await deleteClubMutation.mutateAsync(clubId);
      navigate("/clubs");
    } catch (err) {
      console.error("Failed to delete club:", err);
    }
  };

  const handleLeave = async () => {
    if (!clubId) return;
    try {
      await leaveClubMutation.mutateAsync(clubId);
    } catch (err) {
      console.error("Failed to leave club:", err);
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  if (error || !club) {
    return (
      <Layout>
        <div className="p-8 text-center">
          <p className="text-gray-500 dark:text-gray-400">
            {t("clubNotFound")}
          </p>
          <Link
            to="/clubs"
            className="text-teal-600 hover:underline mt-2 inline-block"
          >
            {t("returnToClubs")}
          </Link>
        </div>
      </Layout>
    );
  }

  const isAdminOrMod =
    club.memberRole === "owner" || club.memberRole === "moderator";
  const moderators = club.moderators || [];
  const members = club.members || [];
  const threads = club.threads || [];
  const pinnedThread = threads.find((t: ClubThread) => t.isPinned);
  const regularThreads = threads.filter((t: ClubThread) => !t.isPinned);

  return (
    <Layout>
      {club && (
        <SEOHead
          title={club.name}
          description={
            club.description
              ? club.description.substring(0, 160)
              : `${club.name} – klubi Eulesia-alustalla`
          }
          path={`/clubs/${clubId}`}
          image={club.coverImageUrl || undefined}
          noIndex={!club.isPublic}
        />
      )}
      {/* Back navigation */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("backToClubs")}
        </button>
      </div>

      {/* Cover image */}
      {club.coverImageUrl && (
        <div className="h-32 sm:h-40 bg-gray-100 dark:bg-gray-800">
          <img
            src={club.coverImageUrl}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Club header */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {club.isPublic ? (
                <span className="text-xs text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Globe className="w-3 h-3" />
                  {t("openClub")}
                </span>
              ) : (
                <span className="text-xs text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  {t("closedClub")}
                </span>
              )}
              {club.category && (
                <span className="text-xs text-teal-700 dark:text-teal-400 bg-teal-100 dark:bg-teal-900/30 px-2 py-0.5 rounded-full">
                  {club.category}
                </span>
              )}
            </div>

            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">
              {club.name}
            </h1>

            {club.description && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                {club.description}
              </p>
            )}

            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
              <div className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5" />
                <span>{t("members", { count: club.memberCount })}</span>
              </div>
              <div className="flex items-center gap-1">
                <MessageSquare className="w-3.5 h-3.5" />
                <span>{t("threads", { count: threads.length })}</span>
              </div>
              {club.address && (
                <div className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  <span className="truncate max-w-[200px]">{club.address}</span>
                </div>
              )}
            </div>
          </div>

          {isAdminOrMod && (
            <button
              onClick={openSettings}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors flex-shrink-0"
              title={t("settings")}
            >
              <Settings className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            </button>
          )}
        </div>

        {/* Join/Leave and Follow buttons */}
        <div className="mt-3 flex items-center gap-2">
          {club.isMember ? (
            <button
              onClick={handleLeave}
              disabled={leaveClubMutation.isPending}
              className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {leaveClubMutation.isPending ? t("leaving") : t("leave")}
            </button>
          ) : club.isPublic ? (
            <button
              onClick={handleJoin}
              disabled={joinClubMutation.isPending}
              className="bg-teal-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors disabled:opacity-50"
            >
              {joinClubMutation.isPending ? t("joining") : t("join")}
            </button>
          ) : null}
          {clubId && (
            <FollowButton
              entityType="club"
              entityId={clubId}
              variant="outline"
            />
          )}
          {clubId && <ReportButton contentType="club" contentId={clubId} />}
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-900 rounded-t-xl z-10">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                {t("editClub")}
              </h3>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              >
                <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("create.name")}
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("create.description")}
                </label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
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
                  value={
                    availableCategories.includes(editCategory)
                      ? editCategory
                      : editCategory
                        ? "__other__"
                        : ""
                  }
                  onChange={(e) =>
                    setEditCategory(
                      e.target.value === "__other__" ? "" : e.target.value,
                    )
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">{t("create.selectCategory")}</option>
                  {availableCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                  <option value="__other__">{t("create.otherCategory")}</option>
                </select>
                {!availableCategories.includes(editCategory) &&
                  editCategory && (
                    <input
                      type="text"
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
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
                {editCoverImage ? (
                  <div className="relative">
                    <img
                      src={editCoverImage}
                      alt=""
                      className="w-full h-32 object-cover rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => setEditCoverImage(null)}
                      className="absolute top-2 right-2 p-1 bg-black/50 rounded-full hover:bg-black/70"
                    >
                      <X className="w-4 h-4 text-white" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => settingsImageRef.current?.click()}
                    disabled={isUploadingImage}
                    className="w-full h-24 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400 hover:border-teal-400 hover:text-teal-600 transition-colors disabled:opacity-50"
                  >
                    {isUploadingImage ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
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
                  ref={settingsImageRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={handleSettingsImageUpload}
                  className="hidden"
                />
              </div>

              {/* Location */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("create.location")}
                </label>
                <LocationSearch
                  value={editLocation}
                  onChange={setEditLocation}
                />
                {!editLocation && editAddress && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t("location")}: {editAddress}
                  </p>
                )}
              </div>

              {/* Visibility */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t("create.visibility")}
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="editVisibility"
                      checked={editIsPublic}
                      onChange={() => setEditIsPublic(true)}
                      className="text-teal-600"
                    />
                    <Globe className="w-4 h-4 text-green-600" />
                    <span className="text-sm">{t("create.open")}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="editVisibility"
                      checked={!editIsPublic}
                      onChange={() => setEditIsPublic(false)}
                      className="text-teal-600"
                    />
                    <Lock className="w-4 h-4 text-amber-600" />
                    <span className="text-sm">{t("create.closed")}</span>
                  </label>
                </div>
              </div>

              {/* Rules */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("create.rules")}
                </label>
                {editRules.length > 0 && (
                  <ol className="space-y-1 mb-2">
                    {editRules.map((rule, i) => (
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
                          onClick={() =>
                            setEditRules((prev) =>
                              prev.filter((_, idx) => idx !== i),
                            )
                          }
                          className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                {editRules.length < 10 && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={editRuleInput}
                      onChange={(e) => setEditRuleInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddEditRule();
                        }
                      }}
                      placeholder={t("create.rulePlaceholder")}
                      className="flex-1 px-3 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                    />
                    <button
                      type="button"
                      onClick={handleAddEditRule}
                      disabled={!editRuleInput.trim()}
                      className="px-3 py-1.5 text-sm text-teal-600 hover:bg-teal-50 rounded-lg disabled:opacity-50"
                    >
                      {t("create.addRule")}
                    </button>
                  </div>
                )}
              </div>

              {/* Invite Members (for private clubs) */}
              {!editIsPublic && isAdminOrMod && (
                <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    {t("inviteMembers")}
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={inviteSearch}
                      onChange={(e) => setInviteSearch(e.target.value)}
                      placeholder={t("inviteSearchPlaceholder")}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100 text-sm"
                    />
                    {inviteSearch.length >= 2 &&
                      searchedUsers &&
                      searchedUsers.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-200 dark:border-gray-800 py-1 z-20 max-h-40 overflow-y-auto">
                          {searchedUsers.map(
                            (user: {
                              id: string;
                              name: string;
                              username: string;
                              avatarUrl?: string;
                            }) => {
                              const isMember = members.some(
                                (m) => m.id === user.id,
                              );
                              const isPending = pendingInvitations?.some(
                                (inv) => inv.invitee?.id === user.id,
                              );
                              return (
                                <button
                                  key={user.id}
                                  onClick={() =>
                                    !isMember &&
                                    !isPending &&
                                    handleInviteUser(user.id)
                                  }
                                  disabled={
                                    isMember ||
                                    isPending ||
                                    inviteToClubMutation.isPending
                                  }
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2 disabled:opacity-40"
                                >
                                  {user.avatarUrl ? (
                                    <img
                                      src={user.avatarUrl}
                                      alt=""
                                      className="w-6 h-6 rounded-full"
                                    />
                                  ) : (
                                    <div className="w-6 h-6 rounded-full bg-teal-100 flex items-center justify-center text-[10px] font-medium text-teal-700">
                                      {user.name.charAt(0).toUpperCase()}
                                    </div>
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <span className="text-gray-900 dark:text-gray-100">
                                      {user.name}
                                    </span>
                                    <span className="text-gray-400 dark:text-gray-500 ml-1">
                                      @{user.username}
                                    </span>
                                  </div>
                                  {isMember && (
                                    <span className="text-xs text-gray-400">
                                      {t("alreadyMember")}
                                    </span>
                                  )}
                                  {isPending && (
                                    <span className="text-xs text-amber-500">
                                      {t("invitePending")}
                                    </span>
                                  )}
                                  {!isMember && !isPending && (
                                    <UserPlus className="w-4 h-4 text-teal-600" />
                                  )}
                                </button>
                              );
                            },
                          )}
                        </div>
                      )}
                  </div>

                  {/* Pending invitations list */}
                  {pendingInvitations && pendingInvitations.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                        {t("pendingInvitations")}
                      </p>
                      {pendingInvitations.map((inv) => (
                        <div
                          key={inv.id}
                          className="flex items-center gap-2 text-sm bg-amber-50 dark:bg-amber-950/20 px-3 py-1.5 rounded-lg"
                        >
                          {inv.invitee?.avatarUrl ? (
                            <img
                              src={inv.invitee.avatarUrl}
                              alt=""
                              className="w-5 h-5 rounded-full"
                            />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-teal-100 flex items-center justify-center text-[10px] font-medium text-teal-700">
                              {inv.invitee?.name?.charAt(0)?.toUpperCase() ||
                                "?"}
                            </div>
                          )}
                          <span className="flex-1 text-gray-700 dark:text-gray-300">
                            {inv.invitee?.name}
                          </span>
                          <button
                            onClick={() => handleCancelInvitation(inv.id)}
                            disabled={cancelInvitationMutation.isPending}
                            className="p-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded text-gray-400 dark:text-gray-500"
                            aria-label={t("cancelInvitation")}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Save */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSettings(false)}
                  className="flex-1 px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                  {t("common:actions.cancel")}
                </button>
                <button
                  onClick={handleSaveSettings}
                  disabled={updateClubMutation.isPending || !editName.trim()}
                  className="flex-1 bg-teal-600 text-white py-2 rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {updateClubMutation.isPending ? t("saving") : t("save")}
                </button>
              </div>

              {/* Danger Zone — Delete Club */}
              {club.memberRole === "owner" && (
                <div className="border-t border-gray-200 dark:border-gray-800 pt-4 mt-4">
                  <p className="text-sm font-medium text-red-600 dark:text-red-400 mb-2">
                    {t("dangerZone")}
                  </p>
                  {!confirmDeleteClub ? (
                    <button
                      onClick={() => setConfirmDeleteClub(true)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      {t("deleteClub")}
                    </button>
                  ) : (
                    <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                      <p className="text-sm text-red-700 dark:text-red-300 mb-3">
                        {t("confirmDeleteClub")}
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setConfirmDeleteClub(false)}
                          className="flex-1 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                        >
                          {t("common:actions.cancel")}
                        </button>
                        <button
                          onClick={handleDeleteClub}
                          disabled={deleteClubMutation.isPending}
                          className="flex-1 px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                        >
                          {deleteClubMutation.isPending
                            ? "..."
                            : t("confirmDelete")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="px-4 py-6 space-y-6">
        {/* Community rules */}
        {club.rules && club.rules.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2">
              <ScrollText className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                {t("rules")}
              </h2>
            </div>
            <div className="p-4">
              <ol className="space-y-2">
                {(() => {
                  if (Array.isArray(club.rules)) return club.rules as string[];
                  if (typeof club.rules === "string") {
                    try {
                      const parsed = JSON.parse(club.rules);
                      if (Array.isArray(parsed)) return parsed as string[];
                    } catch {
                      /* not JSON — treat as single rule */
                    }
                    return [club.rules];
                  }
                  return [] as string[];
                })().map((rule: string, i: number) => (
                  <li
                    key={i}
                    className="flex gap-2 text-sm text-gray-700 dark:text-gray-300"
                  >
                    <span className="text-gray-400 dark:text-gray-500 font-medium">
                      {i + 1}.
                    </span>
                    <span>{rule}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {/* Members toggle */}
        {(moderators.length > 0 || members.length > 0) && (
          <button
            onClick={() => setShowMemberList((v) => !v)}
            className="w-full text-left px-4 py-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1.5 transition-colors"
          >
            <Users className="w-3.5 h-3.5" />
            {showMemberList ? t("hideMemberList") : t("memberList")} (
            {club.memberCount})
          </button>
        )}

        {/* Moderators */}
        {showMemberList && moderators.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4 text-teal-600" />
              {t("moderators")}
            </h3>
            <div className="space-y-2">
              {moderators.map((mod, index) => (
                <ActorBadge
                  key={mod.id ?? `moderator-${index}`}
                  user={{ ...mod, avatarInitials: getAvatarInitials(mod.name) }}
                  size="sm"
                />
              ))}
            </div>
          </div>
        )}

        {/* Members */}
        {showMemberList && members.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
              <Users className="w-4 h-4 text-teal-600" />
              {t("memberList")} ({members.length})
            </h3>
            <div className="flex flex-wrap gap-2">
              {members.slice(0, 20).map((member, index) => (
                <div
                  key={member.id ?? `member-${index}`}
                  className="relative flex items-center gap-1.5 px-2 py-1 bg-gray-50 dark:bg-gray-800/50 rounded-full text-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
                >
                  {member.id && (member.canViewProfile ?? true) ? (
                    <Link
                      to={`/user/${member.id}`}
                      className="flex items-center gap-1.5"
                    >
                      {member.avatarUrl ? (
                        <img
                          src={member.avatarUrl}
                          alt=""
                          className="w-5 h-5 rounded-full"
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-teal-100 flex items-center justify-center text-[10px] font-medium text-teal-700">
                          {member.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="text-gray-700 dark:text-gray-300">
                        {member.name}
                      </span>
                      {member.role === "owner" && (
                        <span className="text-[10px] text-teal-700 bg-teal-100 px-1 rounded">
                          {t("moderation.admin")}
                        </span>
                      )}
                      {member.role === "moderator" && (
                        <span className="text-[10px] text-blue-700 bg-blue-100 px-1 rounded">
                          {t("moderation.moderator")}
                        </span>
                      )}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      {member.avatarUrl ? (
                        <img
                          src={member.avatarUrl}
                          alt=""
                          className="w-5 h-5 rounded-full"
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-teal-100 flex items-center justify-center text-[10px] font-medium text-teal-700">
                          {member.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="text-gray-700 dark:text-gray-300">
                        {member.name}
                      </span>
                      {member.role === "owner" && (
                        <span className="text-[10px] text-teal-700 bg-teal-100 px-1 rounded">
                          {t("moderation.admin")}
                        </span>
                      )}
                      {member.role === "moderator" && (
                        <span className="text-[10px] text-blue-700 bg-blue-100 px-1 rounded">
                          {t("moderation.moderator")}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Moderation menu button */}
                  {isAdminOrMod && member.id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMemberMenuOpen(
                          memberMenuOpen === member.id ? null : member.id,
                        );
                      }}
                      className="ml-1 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreVertical className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                    </button>
                  )}

                  {/* Moderation dropdown */}
                  {memberMenuOpen === member.id && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setMemberMenuOpen(null)}
                      />
                      <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-200 dark:border-gray-800 py-1 z-20">
                        {/* Role change - admin only */}
                        {club.memberRole === "owner" && (
                          <>
                            <div className="px-3 py-1.5 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase">
                              {t("moderation.changeRole")}
                            </div>
                            {(["member", "moderator", "owner"] as const).map(
                              (role) => (
                                <button
                                  key={role}
                                  onClick={() => {
                                    if (!member.id) return;
                                    handleChangeRole(member.id, role);
                                  }}
                                  disabled={
                                    member.role === role ||
                                    updateRoleMutation.isPending
                                  }
                                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 ${
                                    member.role === role
                                      ? "text-teal-600 font-medium"
                                      : "text-gray-700 dark:text-gray-300"
                                  }`}
                                >
                                  {t(`moderation.${role}`)}
                                  {member.role === role && " ✓"}
                                </button>
                              ),
                            )}
                            <div className="border-t border-gray-100 dark:border-gray-800 my-1" />
                          </>
                        )}
                        {/* Remove member - admin + mod (mod can't remove admin/mod) */}
                        {!(
                          club.memberRole === "moderator" &&
                          (member.role === "owner" ||
                            member.role === "moderator")
                        ) && (
                          <button
                            onClick={() => {
                              setMemberMenuOpen(null);
                              setConfirmRemoveMember(member);
                            }}
                            className="w-full text-left px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                          >
                            <UserMinus className="w-3.5 h-3.5" />
                            {t("moderation.removeFromClub")}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
              {members.length > 20 && (
                <span className="text-sm text-gray-500 dark:text-gray-400 px-2 py-1">
                  +{members.length - 20}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Confirm remove member dialog */}
        {confirmRemoveMember && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-sm p-6">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
                {t("moderation.confirmRemove")}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                {confirmRemoveMember.name}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmRemoveMember(null)}
                  className="flex-1 px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                  {t("common:actions.cancel")}
                </button>
                <button
                  onClick={() => {
                    if (!confirmRemoveMember.id) return;
                    handleRemoveMember(confirmRemoveMember.id);
                  }}
                  className="flex-1 bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                  disabled={
                    removeMemberMutation.isPending || !confirmRemoveMember.id
                  }
                >
                  {removeMemberMutation.isPending
                    ? "..."
                    : t("moderation.removeFromClub")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Pinned thread */}
        {pinnedThread && (
          <div className="bg-amber-50 rounded-xl border border-amber-200 overflow-hidden">
            <div className="px-4 py-2 bg-amber-100 border-b border-amber-200 flex items-center gap-2 text-amber-800">
              <Pin className="w-4 h-4" />
              <span className="text-sm font-medium">{t("pinnedThread")}</span>
            </div>
            <Link
              to={`/clubs/${club.id}/thread/${pinnedThread.id}`}
              className="block p-4 hover:bg-amber-100/50 transition-colors"
            >
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">
                {pinnedThread.title}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                {pinnedThread.content.substring(0, 150)}...
              </p>
              <div className="mt-2 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                <span>{t("replies", { count: pinnedThread.replyCount })}</span>
                <span>·</span>
                <span>{formatRelativeTime(pinnedThread.updatedAt)}</span>
              </div>
            </Link>
          </div>
        )}

        {/* Threads */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            {t("discussions")}
          </h2>

          {regularThreads.length > 0 ? (
            <div className="space-y-3">
              {regularThreads.map((thread: ClubThread) => (
                <Link
                  key={thread.id}
                  to={`/clubs/${club.id}/thread/${thread.id}`}
                  className="block bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 hover:shadow-md transition-shadow"
                >
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">
                    {thread.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-3">
                    {thread.content.substring(0, 150)}...
                  </p>
                  <div className="flex items-center justify-between">
                    <ActorBadge
                      user={{
                        ...thread.author,
                        avatarInitials: getAvatarInitials(thread.author.name),
                      }}
                      size="sm"
                    />
                    <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                      {(thread.score ?? 0) !== 0 && (
                        <span
                          className={`font-medium ${(thread.score ?? 0) > 0 ? "text-orange-600" : "text-blue-600"}`}
                        >
                          {(thread.score ?? 0) > 0 ? "+" : ""}
                          {thread.score}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <MessageSquare className="w-3.5 h-3.5" />
                        {thread.replyCount}
                      </span>
                      <span>{formatRelativeTime(thread.updatedAt)}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <p>{t("noThreads")}</p>
            </div>
          )}

          {/* Start new thread */}
          {club.isMember && (
            <>
              {showNewThreadForm ? (
                <div className="mt-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                      {t("newDiscussion")}
                    </h3>
                    <button
                      onClick={() => setShowNewThreadForm(false)}
                      className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                    >
                      <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder={t("discussionTitle")}
                    value={newThreadTitle}
                    onChange={(e) => setNewThreadTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:bg-gray-800 dark:text-gray-100"
                  />
                  <textarea
                    placeholder={t("discussionContent")}
                    value={newThreadContent}
                    onChange={(e) => setNewThreadContent(e.target.value)}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none dark:bg-gray-800 dark:text-gray-100"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setShowNewThreadForm(false)}
                      className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                    >
                      {t("common:actions.cancel")}
                    </button>
                    <button
                      onClick={handleCreateThread}
                      disabled={
                        !newThreadTitle.trim() ||
                        !newThreadContent.trim() ||
                        createThreadMutation.isPending
                      }
                      className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Send className="w-4 h-4" />
                      {createThreadMutation.isPending
                        ? t("posting")
                        : t("postDiscussion")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowNewThreadForm(true)}
                  className="mt-4 w-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-4 py-3 rounded-xl text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  {t("startDiscussion")}
                </button>
              )}
            </>
          )}

          <ContentEndMarker message={t("allDiscussionsShown")} />
        </div>
      </div>
    </Layout>
  );
}
