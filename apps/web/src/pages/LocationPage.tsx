import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, MapPin } from "lucide-react";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import { ThreadCard } from "../components/agora";
import { ContentEndMarker } from "../components/common";
import { useThreads, useLocation as useLocationById } from "../hooks/useApi";
import { useAuth } from "../hooks/useAuth";
import type { Thread as ApiThread } from "../lib/api";
import { getAvatarInitials } from "../utils/avatar";

function transformThread(thread: ApiThread) {
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
    institutionalContext: thread.institutionalContext,
    source: thread.source,
    sourceUrl: thread.sourceUrl,
    aiGenerated: thread.aiGenerated,
  };
}

export function LocationPage() {
  const { t } = useTranslation(["agora", "common"]);
  const { locationId } = useParams<{ locationId: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuth();

  const { data: locationData } = useLocationById(locationId ?? "");
  const { data: threadsData, isLoading, error } = useThreads({ locationId });

  const threads = useMemo(() => {
    if (!threadsData?.items) return [];
    return threadsData.items
      .map(transformThread)
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [threadsData]);

  const locationName =
    locationData?.nameFi ||
    locationData?.name ||
    t("agora:location.defaultName");
  const parentName = locationData?.parent?.name;

  return (
    <Layout>
      <SEOHead
        title={locationName}
        description={`${locationName} – keskustelu Eulesia-alustalla`}
        path={`/paikka/${locationId}`}
        type="place"
      />
      {/* Page header */}
      <div className="bg-white dark:bg-gray-900 px-4 py-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {locationName}
              </h1>
              {parentName && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {parentName}
                </p>
              )}
            </div>
          </div>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t("agora:municipality.discussions", { count: threads.length })}
        </p>
      </div>

      {/* Thread list */}
      <div className="px-4 py-4 space-y-4">
        {isLoading && (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="text-center py-12 text-red-600">
            <p>{t("agora:municipality.loadError")}</p>
          </div>
        )}

        {!isLoading && !error && threads.length > 0 && (
          <div className="space-y-3">
            {threadsData?.items.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={transformThread(thread)}
                author={(() => {
                  const a = thread.author ?? {
                    id: "",
                    name: "",
                    role: "citizen" as const,
                  };
                  return { ...a, avatarInitials: getAvatarInitials(a.name) };
                })()}
              />
            ))}
          </div>
        )}

        {!isLoading && !error && threads.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <MapPin className="w-8 h-8 text-blue-400" />
            </div>
            <p className="font-medium text-gray-700 dark:text-gray-300">
              {t("agora:municipality.noDiscussionsYet", {
                defaultValue: "Täällä ei ole vielä keskusteluja.",
              })}
            </p>
            <p className="text-sm mt-1 text-gray-500">
              {t("agora:municipality.beFirst", {
                defaultValue: "Ole ensimmäinen joka aloittaa!",
              })}
            </p>
            {!currentUser && (
              <Link
                to="/"
                className="mt-4 inline-block px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                {t("common:actions.signIn", {
                  defaultValue: "Kirjaudu sisään",
                })}
              </Link>
            )}
          </div>
        )}

        {!isLoading && threads.length > 0 && <ContentEndMarker />}
      </div>
    </Layout>
  );
}
