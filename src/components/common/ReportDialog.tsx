import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X, Loader2 } from "lucide-react";
import { useSubmitReport } from "../../hooks/useAdminApi";
import { useModalAccessibility } from "../../hooks/useModalAccessibility";

interface ReportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  contentType: string;
  contentId: string;
}

const REASONS = [
  "illegal",
  "harassment",
  "spam",
  "misinformation",
  "other",
] as const;

export function ReportDialog({
  isOpen,
  onClose,
  contentType,
  contentId,
}: ReportDialogProps) {
  const { t } = useTranslation("common");
  const [reason, setReason] = useState<string>("");
  const [description, setDescription] = useState("");
  const submitReportMutation = useSubmitReport();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(dialogRef, onClose, isOpen);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!reason) return;
    await submitReportMutation.mutateAsync({
      contentType,
      contentId,
      reason,
      description: description.trim() || undefined,
    });
    onClose();
    setReason("");
    setDescription("");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-dialog-title"
      ref={dialogRef}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6 z-10">
        <div className="flex items-center justify-between mb-4">
          <h2
            id="report-dialog-title"
            className="text-lg font-semibold text-gray-900 dark:text-gray-100"
          >
            {t("report.title")}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          >
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
              {t("report.reason")}
            </label>
            <div className="space-y-2">
              {REASONS.map((r) => (
                <label
                  key={r}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="reason"
                    value={r}
                    checked={reason === r}
                    onChange={(e) => setReason(e.target.value)}
                    className="text-blue-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {t(`report.reasons.${r}`)}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
              {t("report.description")}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("report.descriptionPlaceholder")}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
              rows={3}
            />
          </div>

          <div className="flex gap-2 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-300"
            >
              {t("report.cancel")}
            </button>
            <button
              onClick={handleSubmit}
              disabled={!reason || submitReportMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {submitReportMutation.isPending && (
                <Loader2 className="w-4 h-4 animate-spin" />
              )}
              {t("report.submit")}
            </button>
          </div>

          {submitReportMutation.isSuccess && (
            <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-800 dark:text-green-300">
              {t("report.submitted")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
