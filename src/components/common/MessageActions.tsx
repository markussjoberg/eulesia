import { Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface MessageActionsProps {
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

export function MessageActions({
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: MessageActionsProps) {
  const { t } = useTranslation("common");

  if (!canEdit && !canDelete) return null;

  return (
    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
      {canEdit && (
        <button
          onClick={onEdit}
          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          title={t("actions.edit")}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
      {canDelete && (
        <button
          onClick={onDelete}
          className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors"
          title={t("actions.delete")}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
