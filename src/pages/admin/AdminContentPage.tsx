import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, Trash2, RotateCcw, Loader2 } from "lucide-react";
import { AdminLayout } from "../../components/admin";
import { useRemoveContent, useRestoreContent } from "../../hooks/useAdminApi";

export function AdminContentPage() {
  const { t } = useTranslation("admin");
  const [contentType, setContentType] = useState("thread");
  const [contentId, setContentId] = useState("");

  const removeContentMutation = useRemoveContent();
  const restoreContentMutation = useRestoreContent();

  const handleRemove = () => {
    if (!contentId.trim()) return;
    removeContentMutation.mutate({
      type: contentType,
      id: contentId,
      reason: "Removed via content management",
    });
  };

  const handleRestore = () => {
    if (!contentId.trim()) return;
    restoreContentMutation.mutate({ type: contentType, id: contentId });
  };

  return (
    <AdminLayout>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
        {t("content.title")}
      </h1>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 max-w-xl">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {t("content.manageContent")}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
              {t("content.contentType")}
            </label>
            <select
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="thread">{t("content.thread")}</option>
              <option value="comment">{t("content.comment")}</option>
              <option value="club_thread">{t("content.clubThread")}</option>
              <option value="club_comment">{t("content.clubComment")}</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
              {t("content.contentId")}
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
              <input
                type="text"
                value={contentId}
                onChange={(e) => setContentId(e.target.value)}
                placeholder="UUID..."
                className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-900 dark:text-gray-100"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleRemove}
              disabled={!contentId.trim() || removeContentMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {removeContentMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              {t("content.hide")}
            </button>
            <button
              onClick={handleRestore}
              disabled={!contentId.trim() || restoreContentMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {restoreContentMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              {t("content.restore")}
            </button>
          </div>

          {removeContentMutation.isSuccess && (
            <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-800 dark:text-green-300">
              {t("content.hiddenSuccess")}
            </div>
          )}
          {restoreContentMutation.isSuccess && (
            <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-800 dark:text-green-300">
              {t("content.restoredSuccess")}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
