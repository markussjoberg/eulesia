import { useState, useRef, useEffect } from "react";
import {
  Bell,
  Shield,
  X,
  Search,
  MessageSquare,
  Check,
  Trash2,
  UserPlus,
  Reply,
  AtSign,
  LogIn,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../hooks/useAuth";
import { SearchBar } from "../common/SearchBar";
import { formatRelativeTimeShort } from "../../lib/formatTime";
import {
  useNotifications,
  useUnreadNotificationCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useDeleteNotification,
} from "../../hooks/useApi";
import type { AppNotification } from "../../lib/api";
import { GuideHelpButton } from "../guide/GuideHelpButton";

function NotificationItem({
  notification,
  onNavigate,
}: {
  notification: AppNotification;
  onNavigate: (notification: AppNotification) => void;
}) {
  const { t } = useTranslation();
  const deleteNotification = useDeleteNotification();

  return (
    <div
      role="button"
      tabIndex={0}
      className={`flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${
        !notification.read ? "bg-blue-50/50 dark:bg-blue-900/20" : ""
      }`}
      onClick={() => onNavigate(notification)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNavigate(notification);
        }
      }}
      aria-label={notification.title}
    >
      <div className="flex-shrink-0 mt-0.5">
        {notification.type === "dm" ? (
          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-blue-600" />
          </div>
        ) : notification.type === "new_follower" ? (
          <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
            <UserPlus className="w-4 h-4 text-green-600" />
          </div>
        ) : notification.type === "room_invite" ? (
          <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center">
            <UserPlus className="w-4 h-4 text-teal-600" />
          </div>
        ) : notification.type === "reply" ||
          notification.type === "thread_reply" ? (
          <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
            <Reply className="w-4 h-4 text-purple-600" />
          </div>
        ) : notification.type === "mention" ? (
          <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center">
            <AtSign className="w-4 h-4 text-orange-600" />
          </div>
        ) : (
          <div className="w-8 h-8 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
            <Bell className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm ${!notification.read ? "font-semibold text-gray-900 dark:text-gray-100" : "text-gray-700 dark:text-gray-300"}`}
        >
          {notification.title}
        </p>
        {notification.body && (
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
            {notification.body}
          </p>
        )}
        <p className="text-xs text-gray-400 mt-1">
          {formatRelativeTimeShort(notification.createdAt)}
        </p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {!notification.read && (
          <div className="w-2 h-2 bg-blue-500 rounded-full" />
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            deleteNotification.mutate(notification.id);
          }}
          className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          title={t("actions.delete")}
          aria-label={t("actions.delete")}
        >
          <Trash2 className="w-3 h-3 text-gray-400" />
        </button>
      </div>
    </div>
  );
}

export function TopBar() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { data: notifications } = useNotifications();
  const { data: unreadData } = useUnreadNotificationCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const unreadCount = unreadData?.count ?? 0;

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        notificationRef.current &&
        !notificationRef.current.contains(event.target as Node)
      ) {
        setShowNotifications(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleNotificationClick = (notification: AppNotification) => {
    if (!notification.read) {
      markRead.mutate(notification.id);
    }
    if (notification.link) {
      navigate(notification.link);
    }
    setShowNotifications(false);
  };

  const avatarInitials = currentUser?.name
    ? currentUser.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "U";

  return (
    <header className="fixed top-0 left-0 right-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 z-50 pt-[env(safe-area-inset-top)]">
      <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Brand */}
        <Link to="/" className="flex items-center gap-2 flex-shrink-0">
          <div className="w-8 h-8 bg-blue-800 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">E</span>
          </div>
          <span className="font-semibold text-gray-900 dark:text-gray-100 text-lg hidden sm:block">
            Eulesia
          </span>
          <span className="text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">
            beta
          </span>
        </Link>

        {/* Search bar - desktop */}
        <div
          className="hidden md:block flex-1 max-w-md mx-4"
          data-guide="search"
        >
          <SearchBar placeholder={t("search.placeholder")} />
        </div>

        {/* Right section */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Search button - mobile */}
          <button
            onClick={() => setShowMobileSearch(true)}
            className="md:hidden p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            aria-label={t("search.placeholder")}
          >
            <Search className="w-5 h-5" />
          </button>

          {/* Guide help */}
          <GuideHelpButton />

          {currentUser ? (
            <>
              {/* Notifications */}
              <div
                className="relative"
                ref={notificationRef}
                data-guide="notifications"
              >
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="relative p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                  aria-label={t("notifications.title")}
                  aria-expanded={showNotifications}
                >
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>

                {/* Notifications dropdown */}
                {showNotifications && (
                  <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden z-50">
                    <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                        {t("notifications.title")}
                      </h3>
                      <div className="flex items-center gap-1">
                        {unreadCount > 0 && (
                          <button
                            onClick={() => markAllRead.mutate()}
                            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                            title={t("notifications.markAllReadTitle")}
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">
                              {t("notifications.markAllRead")}
                            </span>
                          </button>
                        )}
                        <button
                          onClick={() => setShowNotifications(false)}
                          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                          aria-label={t("actions.close")}
                        >
                          <X className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                        </button>
                      </div>
                    </div>

                    {notifications && notifications.length > 0 ? (
                      <div className="max-h-96 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                        {notifications.map((notification) => (
                          <NotificationItem
                            key={notification.id}
                            notification={notification}
                            onNavigate={handleNotificationClick}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="p-8 text-center">
                        <Bell className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {t("notifications.empty")}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          {t("notifications.emptyHint")}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Profile */}
              <Link
                to="/profile"
                className="flex items-center gap-2 p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                aria-label={t("nav.profile")}
              >
                <div className="w-8 h-8 bg-teal-600 rounded-full flex items-center justify-center">
                  {currentUser.avatarUrl ? (
                    <img
                      src={currentUser.avatarUrl}
                      alt={currentUser.name}
                      className="w-full h-full rounded-full object-cover"
                    />
                  ) : (
                    <span className="text-white text-xs font-medium">
                      {avatarInitials}
                    </span>
                  )}
                </div>
                {currentUser.identityVerified && (
                  <div className="hidden sm:flex items-center gap-1 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-full">
                    <Shield className="w-3 h-3" />
                    <span>{t("verified")}</span>
                  </div>
                )}
              </Link>
            </>
          ) : (
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-800 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <LogIn className="w-4 h-4" />
              <span>{t("auth:signIn")}</span>
            </Link>
          )}
        </div>
      </div>

      {/* Mobile search overlay */}
      {showMobileSearch && (
        <div className="fixed inset-0 bg-white dark:bg-gray-900 z-50 md:hidden">
          <div className="p-4 pt-[calc(1rem+env(safe-area-inset-top))]">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowMobileSearch(false)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                aria-label={t("actions.close")}
              >
                <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              <div className="flex-1">
                <SearchBar
                  autoFocus
                  placeholder={t("search.placeholderShort")}
                  onClose={() => setShowMobileSearch(false)}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
