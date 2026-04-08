import {
  Users,
  User,
  MapPin,
  Building2,
  Globe,
  ChevronDown,
  Clock,
  TrendingUp,
  Sparkles,
  Compass,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { FeedScope, SortBy, TopPeriod } from "../../lib/api";

interface FeedFiltersProps {
  feedScope: FeedScope;
  onFeedScopeChange: (scope: FeedScope) => void;
  sortBy: SortBy;
  onSortByChange: (sort: SortBy) => void;
  topPeriod: TopPeriod;
  onTopPeriodChange: (period: TopPeriod) => void;
}

const feedScopeOptions: {
  value: FeedScope;
  tKey: string;
  icon: React.ElementType;
}[] = [
  { value: "following", tKey: "scope.all", icon: Users },
  { value: "all", tKey: "scope.explore", icon: Compass },
  { value: "personal", tKey: "scope.personal", icon: User },
  { value: "local", tKey: "scope.local", icon: MapPin },
  { value: "national", tKey: "scope.national", icon: Building2 },
  { value: "european", tKey: "scope.european", icon: Globe },
];

const sortByOptions: {
  value: SortBy;
  tKey: string;
  icon: React.ElementType;
}[] = [
  { value: "recent", tKey: "feed.sort.recent", icon: Clock },
  { value: "new", tKey: "feed.sort.newest", icon: Sparkles },
  { value: "top", tKey: "feed.sort.top", icon: TrendingUp },
];

const topPeriodOptions: { value: TopPeriod; tKey: string }[] = [
  { value: "day", tKey: "feed.period.day" },
  { value: "week", tKey: "feed.period.week" },
  { value: "month", tKey: "feed.period.month" },
  { value: "year", tKey: "feed.period.year" },
];

export function FeedFilters({
  feedScope,
  onFeedScopeChange,
  sortBy,
  onSortByChange,
  topPeriod,
  onTopPeriodChange,
}: FeedFiltersProps) {
  const { t } = useTranslation();
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);
  const periodDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        sortDropdownRef.current &&
        !sortDropdownRef.current.contains(event.target as Node)
      ) {
        setShowSortDropdown(false);
      }
      if (
        periodDropdownRef.current &&
        !periodDropdownRef.current.contains(event.target as Node)
      ) {
        setShowPeriodDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentSort = sortByOptions.find((o) => o.value === sortBy);
  const currentPeriod = topPeriodOptions.find((o) => o.value === topPeriod);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Feed scope tabs */}
      <div
        className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide"
        data-guide="agora-scope"
      >
        {feedScopeOptions.map(({ value, tKey, icon: Icon }) => (
          <button
            key={value}
            onClick={() => onFeedScopeChange(value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              feedScope === value
                ? "bg-blue-800 text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
            aria-pressed={feedScope === value}
          >
            <Icon className="w-4 h-4" />
            {t(tKey)}
          </button>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Sort dropdown */}
      <div className="flex items-center gap-2" data-guide="agora-sort">
        <div className="relative" ref={sortDropdownRef}>
          <button
            onClick={() => setShowSortDropdown(!showSortDropdown)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
          >
            {currentSort && <currentSort.icon className="w-4 h-4" />}
            <span>{currentSort && t(currentSort.tKey)}</span>
            <ChevronDown className="w-4 h-4" />
          </button>

          {showSortDropdown && (
            <div className="absolute top-full right-0 mt-1 bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-200 dark:border-gray-800 py-1 min-w-[160px] z-50">
              {sortByOptions.map(({ value, tKey, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => {
                    onSortByChange(value);
                    setShowSortDropdown(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                    sortBy === value
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {t(tKey)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Time period dropdown (only show when sortBy is 'top') */}
        {sortBy === "top" && (
          <div className="relative" ref={periodDropdownRef}>
            <button
              onClick={() => setShowPeriodDropdown(!showPeriodDropdown)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
            >
              <span>{currentPeriod && t(currentPeriod.tKey)}</span>
              <ChevronDown className="w-4 h-4" />
            </button>

            {showPeriodDropdown && (
              <div className="absolute top-full right-0 mt-1 bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-200 dark:border-gray-800 py-1 min-w-[140px] z-50">
                {topPeriodOptions.map(({ value, tKey }) => (
                  <button
                    key={value}
                    onClick={() => {
                      onTopPeriodChange(value);
                      setShowPeriodDropdown(false);
                    }}
                    className={`w-full px-3 py-2 text-sm text-left transition-colors ${
                      topPeriod === value
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                  >
                    {t(tKey)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
