import { MapPin, Building2, Globe, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
// Public thread scopes (excludes "club" which is internal to club endpoints)
type Scope = "local" | "national" | "european" | "personal";

interface ScopeBadgeProps {
  scope: Scope | string;
  municipalityName?: string;
  municipalityId?: string;
  countryName?: string;
}

const scopeConfig = {
  local: {
    icon: MapPin,
    tKey: "scope.local",
    color: "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20",
  },
  national: {
    icon: Building2,
    tKey: "scope.national",
    color:
      "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20",
  },
  european: {
    icon: Globe,
    tKey: "scope.european",
    color:
      "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20",
  },
  personal: {
    icon: Users,
    tKey: "scope.personal",
    color:
      "text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20",
  },
};

export function ScopeBadge({
  scope,
  municipalityName,
  municipalityId,
  countryName,
}: ScopeBadgeProps) {
  const { t } = useTranslation();
  const config = scopeConfig[scope as Scope] ?? scopeConfig.national;
  const Icon = config.icon;

  // Determine display label
  let displayLabel = t(config.tKey);
  if (scope === "local" && municipalityName) {
    displayLabel = municipalityName;
  } else if (scope === "national" && countryName) {
    displayLabel = countryName;
  }

  const content = (
    <>
      <Icon className="w-3 h-3" />
      <span>{displayLabel}</span>
    </>
  );

  // If municipality is specified for local scope, make it a clickable link
  if (scope === "local" && municipalityId) {
    return (
      <Link
        to={`/kunnat/${municipalityId}`}
        onClick={(e) => e.stopPropagation()}
        className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${config.color} hover:opacity-80 transition-opacity`}
      >
        {content}
      </Link>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${config.color}`}
    >
      {content}
    </span>
  );
}
