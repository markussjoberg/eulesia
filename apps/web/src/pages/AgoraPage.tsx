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
  OnboardingWizard,
  InlineThreadForm,
} from "../components/agora";
import { ContentEndMarker, ThreadListSkeleton } from "../components/common";
import { Compass, MessageSquarePlus, Sparkles } from "lucide-react";
import { useThreads, useVoteThread, useSubscriptions } from "../hooks/useApi";
import { useAuth } from "../hooks/useAuth";
import type {
  Thread as ApiThread,
  FeedScope,
  SortBy,
  TopPeriod,
  ExploreThread,
} from "../lib/api";
import { getAvatarInitials } from "../utils/avatar";

const DAILY_SUBTITLE_INDEX = Math.floor(Date.now() / 86400000) % 5;

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
  const [showWizard, setShowWizard] = useState(false);

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

  const handleWizardComplete = () => {
    setShowWizard(false);
  };

  // Show the Eulesia Info empty-state card when the user has opened the
  // Seuratut (following) tab but is not following anything yet, and no
  // threads came back. We intentionally keep `!isLoading` so the card does
  // not flash in during the initial subscription fetch.
  const showEulesiaInfoCard =
    !!currentUser &&
    feedScopeInitialized &&
    feedScope === "following" &&
    !isLoading &&
    !error &&
    !hasSubscriptions &&
    threads.length === 0;

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
      </div>

      {/* Thread list */}
      <div className="px-4 py-4 space-y-4">
        {/* Inline thread creation */}
        {currentUser && (
          <div data-guide="agora-newthread">
            <InlineThreadForm onSuccess={handleThreadCreated} />
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

        {/* Eulesia Info: empty-state card for the Seuratut tab. Shown as the
            first item above the threads list so that returning users who add
            one subscription still see a reminder to add more, without hiding
            their existing feed. */}
        {showEulesiaInfoCard && (
          <div className="rounded-2xl border border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50 to-teal-50 dark:from-blue-900/20 dark:to-teal-900/20 p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-shrink-0 w-11 h-11 rounded-full bg-blue-600 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {t("infoCard.author", { defaultValue: "Eulesia Info" })}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-blue-600 text-white">
                    {t("infoCard.badge", { defaultValue: "Info" })}
                  </span>
                </div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">
                  {t("infoCard.emptyFollowingTitle", {
                    defaultValue: "Seuratut-feed on vielä tyhjä",
                  })}
                </h2>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  {t("infoCard.emptyFollowingBody", {
                    defaultValue:
                      "Seuraa paikkakuntia, aiheita tai ihmisiä — syötteesi täyttyy niiden postauksilla.",
                  })}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:pl-14">
              <button
                onClick={() => setShowWizard(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                {t("infoCard.openWizard", {
                  defaultValue: "Avaa opas",
                })}
              </button>
              <button
                onClick={() => setFeedScope("all")}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <Compass className="w-4 h-4" />
                {t("infoCard.browseExplore", {
                  defaultValue: "Selaa Tutustu-välilehteä",
                })}
              </button>
            </div>
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

        {/* Empty state with philosopher quotes. Skipped when the Eulesia
            Info card is already showing on the Seuratut tab. */}
        {!isLoading && !error && threads.length === 0 && !showEulesiaInfoCard && (
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

      {/* Onboarding wizard modal — mounted outside the feed column so the
          fullscreen overlay covers the whole viewport. */}
      {showWizard && <OnboardingWizard onComplete={handleWizardComplete} />}
    </Layout>
  );
}
