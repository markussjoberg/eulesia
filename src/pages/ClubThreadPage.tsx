import { useState, useRef, useCallback } from "react";
import { ContentWithPreviews } from "../components/common/ContentWithPreviews";
import { useTranslation } from "react-i18next";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Users,
  ChevronDown,
  Lock,
  Unlock,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import { ActorBadge, ContentEndMarker } from "../components/common";
import { CommentThread } from "../components/agora/CommentThread";
import {
  useClubThread,
  useAddClubComment,
  useUpdateClubThread,
  useDeleteClubThread,
  useDeleteClubComment,
  useVoteClubThread,
  useVoteClubComment,
  useCurrentUser,
} from "../hooks/useApi";
import { ThreadVoteButtons } from "../components/agora/ThreadVoteButtons";
import { formatRelativeTime } from "../lib/formatTime";
import { transformAuthor, transformComment } from "../utils/transforms";

type CommentSort = "best" | "new" | "old" | "controversial";

export function ClubThreadPage() {
  const { t } = useTranslation(["clubs", "agora", "common"]);
  const navigate = useNavigate();
  const { clubId, threadId } = useParams<{
    clubId: string;
    threadId: string;
  }>();
  const [sort, setSort] = useState<CommentSort>("best");
  const [showSortMenu, setShowSortMenu] = useState(false);

  const sortOptions: { value: CommentSort; label: string }[] = [
    { value: "best", label: t("agora:commentSort.best") },
    { value: "new", label: t("agora:commentSort.new") },
    { value: "old", label: t("agora:commentSort.old") },
    { value: "controversial", label: t("agora:commentSort.controversial") },
  ];

  const {
    data: thread,
    isLoading,
    error,
  } = useClubThread(clubId || "", threadId || "");
  const { data: currentUser } = useCurrentUser();
  const addCommentMutation = useAddClubComment(clubId || "", threadId || "");
  const updateThreadMutation = useUpdateClubThread(
    clubId || "",
    threadId || "",
  );
  const deleteThreadMutation = useDeleteClubThread(clubId || "");
  const deleteCommentMutation = useDeleteClubComment(
    clubId || "",
    threadId || "",
  );
  const voteThreadMutation = useVoteClubThread(clubId || "");
  const voteCommentMutation = useVoteClubComment(clubId || "", threadId || "");

  const [commentContent, setCommentContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const [confirmDeleteThread, setConfirmDeleteThread] = useState(false);
  const [confirmDeleteComment, setConfirmDeleteComment] = useState<
    string | null
  >(null);

  // Scroll textarea into view when focused (for mobile keyboard)
  const handleCommentFocus = useCallback(() => {
    setTimeout(() => {
      commentInputRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 300);
  }, []);

  const handleSubmitComment = async () => {
    if (!commentContent.trim() || !threadId || !clubId) return;

    setIsSubmitting(true);
    try {
      await addCommentMutation.mutateAsync({ content: commentContent });
      setCommentContent("");
    } catch (err) {
      console.error("Failed to post comment:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVote = async (commentId: string, value: number) => {
    if (!clubId || !threadId) return;
    voteCommentMutation.mutate({ commentId, value });
  };

  const handleReply = async (parentId: string, content: string) => {
    try {
      await addCommentMutation.mutateAsync({ content, parentId });
    } catch (err) {
      console.error("Failed to reply:", err);
    }
  };

  const handleToggleLock = async () => {
    if (!thread) return;
    try {
      await updateThreadMutation.mutateAsync({ isLocked: !thread.isLocked });
    } catch (err) {
      console.error("Failed to toggle lock:", err);
    }
  };

  const handleTogglePin = async () => {
    if (!thread) return;
    try {
      await updateThreadMutation.mutateAsync({ isPinned: !thread.isPinned });
    } catch (err) {
      console.error("Failed to toggle pin:", err);
    }
  };

  const handleDeleteThread = async () => {
    if (!threadId) return;
    try {
      await deleteThreadMutation.mutateAsync(threadId);
      navigate(`/clubs/${clubId}`);
    } catch (err) {
      console.error("Failed to delete thread:", err);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      await deleteCommentMutation.mutateAsync(commentId);
      setConfirmDeleteComment(null);
    } catch (err) {
      console.error("Failed to delete comment:", err);
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

  if (error || !thread) {
    return (
      <Layout>
        <div className="p-8 text-center">
          <p className="text-gray-500 dark:text-gray-400">
            {t("clubs:threadNotFound")}
          </p>
          <Link
            to={`/clubs/${clubId}`}
            className="text-blue-600 hover:underline mt-2 inline-block"
          >
            {t("clubs:backToClub")}
          </Link>
        </div>
      </Layout>
    );
  }

  const author = transformAuthor(thread.author);
  const comments = thread.comments?.map(transformComment) || [];
  const memberRole = thread.memberRole;
  const isModOrAdmin = memberRole === "admin" || memberRole === "moderator";
  const isThreadAuthor = currentUser?.id === thread.author.id;

  return (
    <Layout>
      {thread && (
        <SEOHead
          title={thread.title}
          description={thread.content
            .substring(0, 160)
            .replace(/[#*_~`>\n]+/g, " ")
            .trim()}
          path={`/clubs/${clubId}/thread/${threadId}`}
          type="article"
          noIndex
        />
      )}
      {/* Back navigation */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-2">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("clubs:backToClub")}
        </button>
      </div>

      {/* Thread header */}
      <div className="px-4 py-3 bg-gradient-to-b from-purple-50 to-white dark:from-purple-900/20 dark:to-gray-900">
        {/* Club indicator + locked badge */}
        <div className="flex items-center gap-2 text-sm text-purple-700 dark:text-purple-400 mb-2">
          <Users className="w-4 h-4" />
          <span className="font-medium">{t("clubs:clubThread")}</span>
          {thread.isLocked && (
            <>
              <Lock className="w-3 h-3 text-red-500" />
              <span className="text-xs text-red-600 font-medium">
                {t("clubs:moderation.threadLocked")}
              </span>
            </>
          )}
          {thread.isPinned && (
            <>
              <Pin className="w-3 h-3 text-amber-500" />
            </>
          )}
          {!thread.isLocked && (
            <>
              <Lock className="w-3 h-3 text-gray-400 dark:text-gray-500" />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t("clubs:membersOnly")}
              </span>
            </>
          )}
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          {thread.title}
        </h1>

        {/* Meta + Vote */}
        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mb-2">
          <ThreadVoteButtons
            threadId={threadId || ""}
            score={thread.score || 0}
            userVote={thread.userVote || 0}
            onVote={(value) =>
              threadId && voteThreadMutation.mutate({ threadId, value })
            }
            isLoading={voteThreadMutation.isPending}
            size="sm"
          />
          <span>
            {t("clubs:published", {
              time: formatRelativeTime(thread.createdAt),
            })}
          </span>
        </div>

        {/* Moderation actions */}
        {(isModOrAdmin || isThreadAuthor) && (
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {isModOrAdmin && (
              <>
                <button
                  onClick={handleToggleLock}
                  disabled={updateThreadMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  {thread.isLocked ? (
                    <Unlock className="w-3.5 h-3.5" />
                  ) : (
                    <Lock className="w-3.5 h-3.5" />
                  )}
                  {thread.isLocked
                    ? t("clubs:moderation.unlockThread")
                    : t("clubs:moderation.lockThread")}
                </button>
                <button
                  onClick={handleTogglePin}
                  disabled={updateThreadMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  {thread.isPinned ? (
                    <PinOff className="w-3.5 h-3.5" />
                  ) : (
                    <Pin className="w-3.5 h-3.5" />
                  )}
                  {thread.isPinned
                    ? t("clubs:moderation.unpinThread")
                    : t("clubs:moderation.pinThread")}
                </button>
              </>
            )}
            <button
              onClick={() => setConfirmDeleteThread(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 rounded-lg border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t("clubs:moderation.deleteThread")}
            </button>
          </div>
        )}

        {/* Author */}
        <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
          <ActorBadge user={author} />
        </div>
      </div>

      {/* Confirm delete thread dialog */}
      {confirmDeleteThread && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
              {t("clubs:moderation.confirmDelete")}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {thread.title}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDeleteThread(false)}
                className="flex-1 px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                {t("common:actions.cancel")}
              </button>
              <button
                onClick={handleDeleteThread}
                disabled={deleteThreadMutation.isPending}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleteThreadMutation.isPending
                  ? "..."
                  : t("clubs:moderation.deleteThread")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete comment dialog */}
      {confirmDeleteComment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
              {t("clubs:moderation.confirmDelete")}
            </h3>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDeleteComment(null)}
                className="flex-1 px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                {t("common:actions.cancel")}
              </button>
              <button
                onClick={() => handleDeleteComment(confirmDeleteComment)}
                disabled={deleteCommentMutation.isPending}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleteCommentMutation.isPending
                  ? "..."
                  : t("clubs:moderation.deleteComment")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content area */}
      <div className="px-4 py-6 space-y-6">
        {/* Thread content */}
        <div className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
          {thread.contentHtml ? (
            <ContentWithPreviews
              html={thread.contentHtml}
              className="prose prose-gray dark:prose-invert max-w-none"
            />
          ) : (
            <div className="prose prose-gray dark:prose-invert max-w-none whitespace-pre-wrap">
              {thread.content}
            </div>
          )}
        </div>

        {/* Discussion section */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("clubs:discussion", { count: comments.length })}
            </h2>

            {/* Sort dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowSortMenu(!showSortMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                {t("clubs:sort", {
                  label: sortOptions.find((o) => o.value === sort)?.label,
                })}
                <ChevronDown className="w-4 h-4" />
              </button>

              {showSortMenu && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowSortMenu(false)}
                  />
                  <div className="absolute right-0 mt-1 w-40 bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-200 dark:border-gray-800 py-1 z-20">
                    {sortOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          setSort(option.value);
                          setShowSortMenu(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 ${
                          sort === option.value
                            ? "text-blue-600 font-medium"
                            : "text-gray-700 dark:text-gray-300"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Comment input - hidden when thread is locked (unless mod/admin) */}
          {thread.isLocked && !isModOrAdmin ? (
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-200 dark:border-gray-800 mb-4 text-center">
              <div className="flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
                <Lock className="w-4 h-4" />
                <span className="text-sm">
                  {t("clubs:moderation.threadLocked")}
                </span>
              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 mb-4">
              <textarea
                ref={commentInputRef}
                value={commentContent}
                onChange={(e) => setCommentContent(e.target.value)}
                onFocus={handleCommentFocus}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (commentContent.trim() && !isSubmitting)
                      handleSubmitComment();
                  }
                }}
                placeholder={t("clubs:thread.writeComment")}
                className="w-full p-3 border border-gray-200 dark:border-gray-800 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                rows={3}
              />
              <div className="flex justify-end mt-3">
                <button
                  onClick={handleSubmitComment}
                  disabled={!commentContent.trim() || isSubmitting}
                  className="bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting
                    ? t("clubs:submitting")
                    : t("clubs:submitReply")}
                </button>
              </div>
            </div>
          )}

          {/* Comments */}
          {comments.length > 0 ? (
            <div className="space-y-4">
              {comments
                .filter((c) => !c.parentId)
                .map((comment) => (
                  <div key={comment.id} className="relative group/comment">
                    {/* Delete comment button */}
                    {(isModOrAdmin || comment.authorId === currentUser?.id) && (
                      <button
                        onClick={() => setConfirmDeleteComment(comment.id)}
                        className="absolute top-2 right-2 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover/comment:opacity-100 transition-opacity z-10"
                        title={t("clubs:moderation.deleteComment")}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-400 hover:text-red-600" />
                      </button>
                    )}
                    <CommentThread
                      comments={[
                        comment,
                        ...comments.filter((c) => c.parentId),
                      ]}
                      onVote={handleVote}
                      onReply={handleReply}
                    />
                  </div>
                ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <p>{t("clubs:noReplies")}</p>
            </div>
          )}

          {/* End marker */}
          <ContentEndMarker message={t("clubs:endOfDiscussion")} />
        </div>
      </div>
    </Layout>
  );
}
