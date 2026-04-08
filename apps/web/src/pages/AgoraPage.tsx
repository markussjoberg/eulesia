import {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect,
} from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import {
  ThreadCard,
  FeedFilters,
  FeedOnboarding,
  InlineThreadForm,
} from "../components/agora";
import { ContentEndMarker, ThreadListSkeleton } from "../components/common";
import {
  MapPin,
  Building2,
  Globe,
  Users,
  HelpCircle,
  MessageSquarePlus,
  UserPlus,
} from "lucide-react";
import {
  useThreads,
  useVoteThread,
  useSubscriptions,
  useMunicipalities,
  useSubscribe,
} from "../hooks/useApi";
import { useAuth } from "../hooks/useAuth";
import type {
  Thread as ApiThread,
  FeedScope,
  SortBy,
  TopPeriod,
  ExploreThread,
  Municipality,
} from "../lib/api";
import { getAvatarInitials } from "../utils/avatar";

const DAILY_SUBTITLE_INDEX = Math.floor(Date.now() / 86400000) % 5;

/** Inline municipality picker shown on Local tab when user has no municipality subscription. */
function LocalMunicipalityPrompt() {
  const { t } = useTranslation(["agora", "common"]);
  const { data: municipalities } = useMunicipalities();
  const subscribeMutation = useSubscribe();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState(false);

  const filtered = (municipalities ?? []).filter((m: Municipality) =>
    m.name.toLowerCase().includes(search.toLowerCase()),
  );
  const shown = search ? filtered.slice(0, 8) : filtered.slice(0, 12);

  const pick = async (m: Municipality) => {
    setPicked(true);
    try {
      await subscribeMutation.mutateAsync({
        entityType: "municipality",
        entityId: m.id,
      });
      // Reload to apply the new subscription filter
      window.location.reload();
    } catch {
      setPicked(false);
    }
  };

  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-4">
      <div className="flex items-start gap-3 mb-3">
        <MapPin className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
            {t("agora:localPrompt.title", {
              defaultValue: "Valitse paikkakuntasi",
            })}
          </h3>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
            {t("agora:localPrompt.description", {
              defaultValue:
                "Näet paikalliset keskustelut kun valitset kotipaikkakuntasi.",
            })}
          </p>
        </div>
      </div>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("agora:localPrompt.searchPlaceholder", {
          defaultValue: "Hae paikkakuntaa...",
        })}
        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="flex flex-wrap gap-1.5">
        {shown.map((m: Municipality) => (
          <button
            key={m.id}
            onClick={() => pick(m)}
            disabled={picked}
            className="px-2.5 py-1 rounded-full text-xs font-medium bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-blue-600 hover:text-white transition-colors disabled:opacity-50"
          >
            {m.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// Transform API thread to component format
function transformThread(thread: ApiThread | ExploreThread) {
  const exploreThread = thread as ExploreThread;
  const bookmarkableThread = thread as ApiThread & { isBookmarked?: boolean };
  return {
    id: thread.id,
    title: thread.title,
    scope: thread.scope,
    municipalityId: thread.municipality?.id,
    municipalityName: thread.municipality?.name,
    tags: thread.tags,
    authorId: thread.authorId ?? thread.author?.id ?? "",
    content: thread.content,
    contentHtml: thread.contentHtml,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    replyCount: thread.replyCount,
    score: thread.score,
    userVote: thread.userVote,
    institutionalContext: thread.institutionalContext,
    source: thread.source,
    sourceUrl: thread.sourceUrl,
    aiGenerated: thread.aiGenerated,
    sourceInstitutionId: thread.sourceInstitutionId,
    sourceInstitutionName: thread.sourceInstitutionName,
    // CVS score (only present in explore feed)
    cvsScore: exploreThread.cvsScore,
    scoreBreakdown: exploreThread.scoreBreakdown,
    isBookmarked: bookmarkableThread.isBookmarked,
  };
}

export function AgoraPage() {
  const { t } = useTranslation("agora");
  const navigate = useNavigate();
  const { currentUser } = useAuth();

  // Feed state
  const [feedScope, setFeedScope] = useState<FeedScope>("all");
  const [feedScopeInitialized, setFeedScopeInitialized] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("recent");
  const [topPeriod, setTopPeriod] = useState<TopPeriod>("week");
  const [selectedTags] = useState<string[]>([]);
  const [selectedMunicipality] = useState<string | undefined>();
  const [showOnboarding, setShowOnboarding] = useState(false);

  const { data: subscriptionsData } = useSubscriptions();

  const [page, setPage] = useState(1);
  const [allThreads, setAllThreads] = useState<
    {
      thread: ReturnType<typeof transformThread>;
      author: {
        id: string;
        name: string;
        role: string;
        avatarInitials: string;
        [key: string]: unknown;
      };
    }[]
  >([]);

  // Build filters for the API
  const filters = useMemo(
    () => ({
      feedScope,
      sortBy,
      topPeriod: sortBy === "top" ? topPeriod : undefined,
      municipalityId: selectedMunicipality,
      tags: selectedTags.length > 0 ? selectedTags : undefined,
      page,
    }),
    [feedScope, sortBy, topPeriod, selectedMunicipality, selectedTags, page],
  );

  const { data: threadsData, isLoading, error } = useThreads(filters);
  const voteThreadMutation = useVoteThread(filters);

  // Reset pagination when filters change
  useEffect(() => {
    // Filter changes intentionally restart pagination from page one.

    setPage(1);
    setAllThreads([]);
  }, [feedScope, sortBy, topPeriod, selectedMunicipality, selectedTags]);

  // Determine if user has subscriptions
  const hasSubscriptions = useMemo(() => {
    if (!subscriptionsData) return false;
    return subscriptionsData.length > 0;
  }, [subscriptionsData]);

  // Set default feed scope based on subscriptions (only once on initial load)
  useEffect(() => {
    if (feedScopeInitialized) return;
    if (!currentUser) {
      // Unauthenticated: always show 'all' feed

      setFeedScope("all");
      setFeedScopeInitialized(true);
      return;
    }
    if (subscriptionsData !== undefined) {
      if (hasSubscriptions) {
        setFeedScope("following");
      } else {
        setFeedScope("all");
      }
      setFeedScopeInitialized(true);
    }
  }, [currentUser, subscriptionsData, hasSubscriptions, feedScopeInitialized]);

  // Accumulate threads across pages
  useEffect(() => {
    if (!threadsData?.items) return;
    const newItems = threadsData.items.map((item) => ({
      thread: transformThread(item),
      author: (() => {
        const a = item.author ?? { id: "", name: "", role: "citizen" as const };
        return { ...a, avatarInitials: getAvatarInitials(a.name) };
      })(),
    }));
    if (page === 1) {
      setAllThreads(newItems);
    } else {
      setAllThreads((prev) => {
        const existingIds = new Set(prev.map((t) => t.thread.id));
        const unique = newItems.filter((t) => !existingIds.has(t.thread.id));
        return [...prev, ...unique];
      });
    }
  }, [threadsData, page]);

  const threads = allThreads;

  // Infinite scroll with IntersectionObserver
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const hasMore = threadsData?.hasMore ?? false;

  const loadNextPage = useCallback(() => {
    if (!isLoading && hasMore) {
      setPage((p) => p + 1);
    }
  }, [isLoading, hasMore]);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadNextPage]);

  // Is this a personalized scope with no subscriptions?
  // Show as compact banner above content (content is now always shown as fallback)
  const isPersonalizedScope = ["local", "national", "european"].includes(
    feedScope,
  );
  // Personal scope doesn't need subscription hints
  const showScopeHint = isPersonalizedScope && !isLoading && !hasSubscriptions;

  const handleVote = (threadId: string, value: number) => {
    if (!currentUser) return;
    voteThreadMutation.mutate({ threadId, value });
  };

  // --- Scroll position save/restore ---
  const scrollRestored = useRef(false);
  const SCROLL_KEY = "agora_scroll_y";

  // Save scroll position on scroll (debounced)
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
          ticking = false;
        });
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Restore scroll position after threads have loaded (only once per visit)
  useLayoutEffect(() => {
    if (scrollRestored.current) return;
    if (threads.length === 0) return;

    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) {
      const y = parseInt(saved, 10);
      if (y > 0) {
        // Small delay to let the DOM render the thread cards first
        requestAnimationFrame(() => {
          window.scrollTo(0, y);
        });
      }
    }
    scrollRestored.current = true;
  }, [threads.length]);

  // Clear saved scroll when filters change (starting fresh)
  useEffect(() => {
    sessionStorage.removeItem(SCROLL_KEY);
    scrollRestored.current = false;
  }, [feedScope, sortBy, topPeriod, selectedMunicipality, selectedTags]);

  const handleThreadCreated = (threadId: string) => {
    navigate(`/agora/thread/${threadId}`);
  };

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
  };

  return (
    <Layout>
      <SEOHead
        title="Agora – Kansalaiskeskustelu"
        description="Osallistu kansalaiskeskusteluun Eulesia-alustalla. Keskustele paikallisista, kansallisista ja eurooppalaisista aiheista."
        path="/agora"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "Agora – Kansalaiskeskustelu",
          description: "Osallistu kansalaiskeskusteluun Eulesia-alustalla.",
          isPartOf: {
            "@type": "WebSite",
            name: "Eulesia",
            url: "https://eulesia.org",
          },
        }}
      />

      {/* Page header */}
      <div
        className="bg-white dark:bg-gray-900 px-4 py-4 border-b border-gray-200 dark:border-gray-800"
        data-guide="agora-header"
      >
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {t("title")}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {t(`subtitle_${DAILY_SUBTITLE_INDEX}`, {
                defaultValue: t("subtitle"),
              })}
            </p>
          </div>
          {currentUser && (
            <button
              onClick={() => setShowOnboarding((v) => !v)}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              title={t("agora:onboarding.welcome", { defaultValue: "Ohjeet" })}
            >
              <HelpCircle className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Thread list */}
      <div className="px-4 py-4 space-y-4">
        {/* Inline thread creation */}
        {currentUser && (
          <div data-guide="agora-newthread">
            <InlineThreadForm
              defaultScope={
                ["local", "national", "european", "personal"].includes(
                  feedScope,
                )
                  ? (feedScope as
                      | "local"
                      | "national"
                      | "european"
                      | "personal")
                  : undefined
              }
              onSuccess={handleThreadCreated}
            />
          </div>
        )}

        {/* Scope tabs + sort */}
        <FeedFilters
          feedScope={feedScope}
          onFeedScopeChange={setFeedScope}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          topPeriod={topPeriod}
          onTopPeriodChange={setTopPeriod}
        />

        {isLoading && page === 1 && <ThreadListSkeleton count={4} />}

        {error && (
          <div className="text-center py-12 text-red-600">
            <p>{t("loadError")}</p>
            <p className="text-sm mt-1">
              {error instanceof Error
                ? error.message
                : t("common:errors.unknown")}
            </p>
          </div>
        )}

        {/* Manual onboarding via "?" button */}
        {showOnboarding && (
          <div className="py-4">
            <FeedOnboarding
              onComplete={() => {
                handleOnboardingComplete();
                setShowOnboarding(false);
              }}
            />
          </div>
        )}

        {/* Scope-specific banner when no subscriptions */}
        {!isLoading && !error && showScopeHint && feedScope === "local" && (
          <LocalMunicipalityPrompt />
        )}
        {!isLoading && !error && showScopeHint && feedScope !== "local" && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-center gap-3">
            <div className="flex-shrink-0">
              {feedScope === "national" && (
                <Building2 className="w-5 h-5 text-blue-600" />
              )}
              {feedScope === "european" && (
                <Globe className="w-5 h-5 text-blue-600" />
              )}
            </div>
            <p className="text-sm text-blue-800 dark:text-blue-300 flex-1">
              {t("emptyScope.hint")}
            </p>
            <button
              onClick={() => {
                setFeedScope("following");
              }}
              className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Users className="w-3.5 h-3.5" />
              {t("emptyScope.startFollowing")}
            </button>
          </div>
        )}

        {/* Thread list */}
        {!isLoading && !error && threads.length > 0 && (
          <div className="space-y-3">
            {threads.map((item, index) => (
              <div
                key={item.thread.id}
                {...(index === 0 ? { "data-guide": "agora-threadcard" } : {})}
              >
                <ThreadCard
                  thread={item.thread}
                  author={item.author}
                  onVote={handleVote}
                  isVoting={voteThreadMutation.isPending}
                />
              </div>
            ))}
          </div>
        )}

        {/* Empty state with philosopher quotes */}
        {!isLoading && !error && threads.length === 0 && (
          <div className="text-center py-16 px-6">
            <div className="max-w-md mx-auto">
              <p className="text-lg italic text-gray-600 dark:text-gray-300 mb-1">
                {t(`emptyQuote_${Math.floor(Date.now() / 86400000) % 7}`, {
                  defaultValue: t("noThreads"),
                })}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-6">
                —{" "}
                {t(
                  `emptyQuoteAttribution_${Math.floor(Date.now() / 86400000) % 7}`,
                  {
                    defaultValue: "",
                  },
                )}
              </p>
              {currentUser ? (
                feedScope === "personal" ? (
                  <button
                    onClick={() => navigate("/explore")}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <UserPlus className="w-4 h-4" />
                    {t("emptyQuoteCtaPersonal")}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      const form = document.querySelector(
                        '[data-guide="agora-newthread"]',
                      );
                      if (form) {
                        form.scrollIntoView({ behavior: "smooth" });
                        const input = form.querySelector("input, textarea");
                        if (input) (input as HTMLElement).focus();
                      }
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <MessageSquarePlus className="w-4 h-4" />
                    {t("emptyQuoteCta")}
                  </button>
                )
              ) : null}
            </div>
          </div>
        )}

        {/* Infinite scroll trigger / End marker */}
        {threads.length > 0 &&
          (hasMore ? (
            <>
              <div ref={loadMoreRef} className="py-4" />
              {isLoading && page > 1 && (
                <div className="flex justify-center py-6">
                  <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </>
          ) : (
            !isLoading && <ContentEndMarker />
          ))}
      </div>
    </Layout>
  );
}
