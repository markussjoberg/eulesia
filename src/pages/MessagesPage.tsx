import { Link } from "react-router-dom";
import { MessageSquare, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import { useConversations } from "../hooks/useApi";

import { formatMessageDate } from "../lib/formatTime";
import type { Conversation } from "../lib/api";

function getAvatarInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function ConversationItem({ conversation }: { conversation: Conversation }) {
  const { t } = useTranslation("messages");
  const { otherUser, lastMessage, unreadCount, updatedAt } = conversation;

  if (!otherUser) return null;

  return (
    <Link
      to={`/messages/${conversation.id}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-100 dark:border-gray-800"
    >
      {/* Avatar */}
      <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
        {otherUser.avatarUrl ? (
          <img
            src={otherUser.avatarUrl}
            alt=""
            className="w-full h-full rounded-full object-cover"
          />
        ) : (
          <span className="text-white text-sm font-bold">
            {getAvatarInitials(otherUser.name)}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span
            className={`text-sm truncate ${unreadCount > 0 ? "font-bold text-gray-900 dark:text-gray-100" : "font-medium text-gray-900 dark:text-gray-100"}`}
          >
            {otherUser.name}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 ml-2">
            {formatMessageDate(lastMessage?.createdAt || updatedAt)}
          </span>
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <p
            className={`text-sm truncate ${unreadCount > 0 ? "text-gray-900 dark:text-gray-100 font-medium" : "text-gray-500 dark:text-gray-400"}`}
          >
            {lastMessage
              ? lastMessage.content.substring(0, 80)
              : t("noMessagesPreview")}
          </p>
          {unreadCount > 0 && (
            <span className="ml-2 bg-blue-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function MessagesPage() {
  const { t } = useTranslation("messages");
  const { data: conversations, isLoading } = useConversations();

  return (
    <Layout>
      <SEOHead title={t("title")} path="/messages" noIndex />
      {/* Header */}
      <div
        className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-4"
        data-guide="messages-header"
      >
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          {t("title")}
        </h1>
      </div>

      {/* Conversations list */}
      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : conversations && conversations.length > 0 ? (
        <div
          className="bg-white dark:bg-gray-900"
          data-guide="messages-conversation"
        >
          {conversations.map((conv) => (
            <ConversationItem key={conv.id} conversation={conv} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 px-4">
          <MessageSquare className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
            {t("noConversations")}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {t("noConversationsHint")}
          </p>
          <Link
            to="/agora"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-800 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Search className="w-4 h-4" />
            {t("common:nav.agora")}
          </Link>
        </div>
      )}
    </Layout>
  );
}
