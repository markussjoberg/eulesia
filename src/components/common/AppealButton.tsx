import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Scale, X, Loader2 } from "lucide-react";
import { useSubmitAppeal } from "../../hooks/useAdminApi";

interface AppealButtonProps {
  sanctionId: string;
}

export function AppealButton({ sanctionId }: AppealButtonProps) {
  const { t } = useTranslation("common");
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const submitAppealMutation = useSubmitAppeal();

  const handleSubmit = async () => {
    if (!reason.trim() || reason.length < 10) return;
    await submitAppealMutation.mutateAsync({
      sanctionId,
      reason,
    });
    setIsOpen(false);
    setReason("");
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
      >
        <Scale className="w-4 h-4" />
        {t("appeal.submit")}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setIsOpen(false)}
          />
          <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6 z-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t("appeal.title")}
              </h2>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              >
                <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
                  {t("appeal.reason")}
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("appeal.reasonPlaceholder")}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100"
                  rows={4}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t("appeal.minimumLength")}
                </p>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-300"
                >
                  {t("appeal.cancel")}
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={
                    reason.length < 10 || submitAppealMutation.isPending
                  }
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitAppealMutation.isPending && (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                  {t("appeal.send")}
                </button>
              </div>

              {submitAppealMutation.isSuccess && (
                <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-800 dark:text-green-300">
                  {t("appeal.submitted")}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
