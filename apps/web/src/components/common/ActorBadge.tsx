import { Building2, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
interface ActorUser {
  id: string | null;
  name: string;
  role: string;
  avatarUrl?: string | null;
  avatarInitials?: string;
  verified?: boolean;
  canViewProfile?: boolean;
  institutionType?: string;
  institutionName?: string;
}

interface ActorBadgeProps {
  user: ActorUser;
  showName?: boolean;
  size?: "sm" | "md" | "lg";
}

export function ActorBadge({
  user,
  showName = true,
  size = "md",
}: ActorBadgeProps) {
  const isInstitution = user.role === "institution";
  const canLinkToProfile = Boolean(user.id) && (user.canViewProfile ?? true);

  const sizeClasses = {
    sm: "w-6 h-6 text-xs",
    md: "w-8 h-8 text-sm",
    lg: "w-10 h-10 text-base",
  };

  const avatarColor = isInstitution ? "bg-violet-600" : "bg-teal-600";
  const content = (
    <>
      {user.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt={user.name}
          className={`${sizeClasses[size]} rounded-full object-cover`}
        />
      ) : (
        <div
          className={`${sizeClasses[size]} ${avatarColor} rounded-full flex items-center justify-center text-white font-medium`}
        >
          {user.avatarInitials}
        </div>
      )}

      {showName && (
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span
              className={`font-medium text-gray-900 dark:text-gray-100 ${canLinkToProfile ? "hover:underline" : ""} ${size === "sm" ? "text-sm" : ""}`}
            >
              {user.name}
            </span>

            {isInstitution ? (
              <span className="inline-flex items-center gap-1 text-xs text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 px-1.5 py-0.5 rounded">
                <Building2 className="w-3 h-3" />
                <span>Official</span>
              </span>
            ) : user.verified ? (
              <span className="inline-flex items-center gap-0.5 text-xs text-green-600">
                <ShieldCheck className="w-3 h-3" />
              </span>
            ) : null}
          </div>

          {isInstitution && user.institutionType && (
            <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">
              {user.institutionType}
            </span>
          )}
        </div>
      )}
    </>
  );

  if (!canLinkToProfile) {
    return <div className="flex items-center gap-2">{content}</div>;
  }

  return (
    <Link
      to={`/user/${user.id}`}
      className="flex items-center gap-2 hover:opacity-80 transition-opacity"
      onClick={(e) => e.stopPropagation()}
    >
      {content}
    </Link>
  );
}
