import { MessageSquare, Building2, Bot, Share2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Thread, User } from "../../types";
import type { CvsBreakdown } from "../../lib/api";
import { ScopeBadge } from "../common/ScopeBadge";
import { ThreadVoteButtons } from "./ThreadVoteButtons";
import { ThreadCardMedia } from "./ThreadCardMedia";
import { BookmarkButton } from "../discover/BookmarkButton";
import { ScoreBreakdown } from "../discover/ScoreBreakdown";
import { formatRelativeTime } from "../../lib/formatTime";

interface ThreadCardProps {
  thread: Thread & {
    score?: number;
    userVote?: number;
    cvsScore?: number;
    scoreBreakdown?: CvsBreakdown;
    isBookmarked?: boolean;
  };
  author: User;
  onVote?: (threadId: string, value: number) => void;
  isVoting?: boolean;
}

export function ThreadCard({
  thread,
  author,
  onVote,
  isVoting = false,
}: ThreadCardProps) {
  const { t } = useTranslation("agora");
  const isInstitutional = author.role === "institution";
  const isAiGenerated =
    thread.aiGenerated || thread.source === "minutes_import";
  const isBotSummary = isAiGenerated && thread.source === "rss_import";
  const isMinutesSummary = isAiGenerated && thread.source === "minutes_import";
  const showVoting = typeof thread.score === "number";

  const handleVote = (value: number) => {
    if (onVote) {
      onVote(thread.id, value);
    }
  };

  return (
    <div
      className={`bg-white dark:bg-gray-900 rounded-xl hover:shadow-md transition-shadow border ${
        isAiGenerated
          ? "border-purple-200 dark:border-purple-800"
          : isInstitutional
            ? "border-violet-200 dark:border-violet-800"
            : "border-gray-200 dark:border-gray-800"
      }`}
    >
      <div className="flex">
        {/* Vote buttons column */}
        {showVoting && (
          <div className="flex-shrink-0 py-3 pl-3 pr-1">
            <ThreadVoteButtons
              threadId={thread.id}
              score={thread.score ?? 0}
              userVote={thread.userVote ?? 0}
              onVote={handleVote}
              isLoading={isVoting}
              size="sm"
            />
          </div>
        )}

        {/* Content column */}
        <Link
          to={`/agora/thread/${thread.id}`}
          className={`flex-grow p-3 ${showVoting ? "pl-2" : ""} min-w-0`}
        >
          {/* Top row: avatar + name + indicators + time */}
          <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
            {author.avatarUrl ? (
              <img
                src={author.avatarUrl}
                alt=""
                className="w-5 h-5 rounded-full object-cover flex-shrink-0"
              />
            ) : (
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-medium flex-shrink-0 ${isInstitutional ? "bg-violet-600" : "bg-teal-600"}`}
              >
                {author.avatarInitials}
              </div>
            )}
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
              {author.name}
            </span>
            {isInstitutional && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/30 px-1 py-0.5 rounded flex-shrink-0">
                <Building2 className="w-2.5 h-2.5" />
              </span>
            )}
            {(isBotSummary || isMinutesSummary) && (
              <span className="inline-flex items-center text-purple-500 dark:text-purple-400 flex-shrink-0">
                <Bot className="w-3.5 h-3.5" />
              </span>
            )}
            {isAiGenerated && thread.sourceInstitutionName && (
              <Link
                to={
                  thread.sourceInstitutionId
                    ? `/user/${thread.sourceInstitutionId}`
                    : "#"
                }
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-0.5 text-[10px] text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-1.5 py-0.5 rounded hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors truncate max-w-[150px] flex-shrink-0"
              >
                <Building2 className="w-2.5 h-2.5 flex-shrink-0" />
                {thread.sourceInstitutionName}
              </Link>
            )}
            <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 ml-auto">
              {formatRelativeTime(thread.updatedAt)}
            </span>
          </div>

          {/* Title */}
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1 leading-snug">
            {thread.title}
          </h3>

          {/* Preview content */}
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2 line-clamp-2">
            {thread.content.split("\n")[0].replace(/[*#]/g, "")}
          </p>

          {/* Embedded media preview */}
          {thread.contentHtml && (
            <ThreadCardMedia contentHtml={thread.contentHtml} />
          )}

          {/* Bottom row: scope + replies + share */}
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <ScopeBadge
              scope={thread.scope}
              municipalityId={thread.municipalityId}
              municipalityName={thread.municipalityName}
            />
            <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
              <span className="flex items-center gap-1">
                <MessageSquare className="w-3.5 h-3.5" />
                {thread.replyCount}
              </span>
              <BookmarkButton
                threadId={thread.id}
                isBookmarked={thread.isBookmarked}
                size="sm"
              />
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const url = `${window.location.origin}/agora/thread/${thread.id}`;
                  if (navigator.share) {
                    navigator.share({ title: thread.title, url });
                  } else {
                    navigator.clipboard.writeText(url);
                  }
                }}
                className="flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                title={t("common:share.share")}
              >
                <Share2 className="w-3.5 h-3.5" />
              </button>
              {thread.cvsScore != null && thread.scoreBreakdown && (
                <ScoreBreakdown
                  score={thread.cvsScore}
                  breakdown={thread.scoreBreakdown}
                />
              )}
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
