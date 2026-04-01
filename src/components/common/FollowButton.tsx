import { UserPlus, UserCheck, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useSubscribe,
  useUnsubscribe,
  useSubscriptionCheck,
} from "../../hooks/useApi";
import { useAuth } from "../../hooks/useAuth";
import type { EntityType } from "../../lib/api";

interface FollowButtonProps {
  entityType: EntityType;
  entityId: string;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "outline" | "ghost";
  className?: string;
}

export function FollowButton({
  entityType,
  entityId,
  size = "md",
  variant = "default",
  className = "",
}: FollowButtonProps) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { data: subscription, isLoading: checkLoading } = useSubscriptionCheck(
    entityType,
    entityId,
  );
  const subscribeMutation = useSubscribe();
  const unsubscribeMutation = useUnsubscribe();

  const isSubscribed = subscription?.subscribed ?? false;
  const isLoading =
    checkLoading ||
    subscribeMutation.isPending ||
    unsubscribeMutation.isPending;

  // Don't show follow button if not logged in
  if (!currentUser) {
    return null;
  }

  // Don't let user follow themselves
  if (entityType === "user" && entityId === currentUser.id) {
    return null;
  }

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isLoading) return;

    if (isSubscribed) {
      await unsubscribeMutation.mutateAsync({ entityType, entityId });
    } else {
      await subscribeMutation.mutateAsync({ entityType, entityId });
    }
  };

  const sizeClasses = {
    sm: "px-2 py-1 text-xs gap-1",
    md: "px-3 py-1.5 text-sm gap-1.5",
    lg: "px-4 py-2 text-base gap-2",
  };

  const iconSizes = {
    sm: "w-3 h-3",
    md: "w-4 h-4",
    lg: "w-5 h-5",
  };

  const variantClasses = {
    default: isSubscribed
      ? "bg-teal-600 text-white hover:bg-red-600"
      : "bg-blue-600 text-white hover:bg-blue-700",
    outline: isSubscribed
      ? "border border-teal-600 text-teal-700 dark:text-teal-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-600 hover:text-red-700 dark:hover:text-red-400"
      : "border border-blue-600 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20",
    ghost: isSubscribed
      ? "text-teal-700 dark:text-teal-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-700 dark:hover:text-red-400"
      : "text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20",
  };

  return (
    <button
      onClick={handleClick}
      disabled={isLoading}
      className={`
        inline-flex items-center font-medium rounded-full transition-colors
        disabled:opacity-50 disabled:cursor-not-allowed
        ${sizeClasses[size]}
        ${variantClasses[variant]}
        ${className}
      `}
    >
      {isLoading ? (
        <Loader2 className={`${iconSizes[size]} animate-spin`} />
      ) : isSubscribed ? (
        <UserCheck className={iconSizes[size]} />
      ) : (
        <UserPlus className={iconSizes[size]} />
      )}
      <span>{isSubscribed ? t("actions.following") : t("actions.follow")}</span>
    </button>
  );
}
