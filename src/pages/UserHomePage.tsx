import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Home,
  Globe,
  Lock,
  MessageSquare,
  ChevronRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import { useHome } from "../hooks/useApi";
import { useAuth } from "../hooks/useAuth";
import type { Room } from "../lib/api";

export function UserHomePage() {
  const { t } = useTranslation("home");
  const { userId } = useParams<{ userId: string }>();
  const { currentUser } = useAuth();
  const { data: homeData, isLoading, error } = useHome(userId || "");

  if (isLoading) {
    return (
      <Layout>
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  if (error || !homeData) {
    return (
      <Layout>
        <div className="px-4 py-12 text-center">
          <p className="text-gray-500 mb-4">{t("userHome.loadError")}</p>
          <button
            onClick={() => window.history.back()}
            className="text-teal-600 hover:underline"
          >
            {t("common:actions.back")}
          </button>
        </div>
      </Layout>
    );
  }

  // Redirect to own home if viewing own page
  if (currentUser?.id === userId) {
    return (
      <Layout>
        <div className="px-4 py-12 text-center">
          <p className="text-gray-600 mb-4">{t("userHome.ownHomeRedirect")}</p>
          <Link to="/home" className="text-teal-600 hover:underline">
            {t("userHome.goToHome")}
          </Link>
        </div>
      </Layout>
    );
  }

  const publicRooms = homeData.rooms.filter(
    (r: Room) => r.visibility === "public",
  );
  const accessiblePrivateRooms = homeData.rooms.filter(
    (r: Room) => r.visibility === "private" && r.canAccess,
  );

  return (
    <Layout>
      <SEOHead
        title={`${homeData.owner.name} – ${t("userHome.homePageTitle")}`}
        path={`/home/${userId}`}
        noIndex
      />
      {/* Header */}
      <div className="bg-gradient-to-r from-teal-700 to-teal-600 px-4 py-5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.history.back()}
            className="p-2 -ml-2 hover:bg-white/10 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
            <Home className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">
              {homeData.owner.name}
            </h1>
            <p className="text-sm text-teal-100">
              {t("userHome.homePageTitle")}
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 py-4 space-y-6">
        {/* Public Rooms */}
        {publicRooms.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Globe className="w-4 h-4" />
              {t("userHome.publicRooms")}
            </h2>
            <div className="space-y-2">
              {publicRooms.map((room: Room) => (
                <RoomCard key={room.id} room={room} />
              ))}
            </div>
          </div>
        )}

        {/* Accessible Private Rooms */}
        {accessiblePrivateRooms.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Lock className="w-4 h-4" />
              {t("userHome.accessibleRooms")}
            </h2>
            <div className="space-y-2">
              {accessiblePrivateRooms.map((room: Room) => (
                <RoomCard key={room.id} room={room} />
              ))}
            </div>
          </div>
        )}

        {publicRooms.length === 0 && accessiblePrivateRooms.length === 0 && (
          <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
            <MessageSquare className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            <p className="text-gray-600 dark:text-gray-400">
              {t("userHome.noRooms")}
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}

function RoomCard({ room }: { room: Room }) {
  const { t } = useTranslation("home");

  return (
    <Link
      to={`/home/room/${room.id}`}
      className="flex items-center justify-between p-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:shadow-md transition-shadow"
    >
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            room.visibility === "public" ? "bg-green-100" : "bg-amber-100"
          }`}
        >
          {room.visibility === "public" ? (
            <Globe className="w-5 h-5 text-green-600" />
          ) : (
            <Lock className="w-5 h-5 text-amber-600" />
          )}
        </div>
        <div>
          <h3 className="font-medium text-gray-900 dark:text-gray-100">
            {room.name}
          </h3>
          {room.description && (
            <p className="text-xs text-gray-500 truncate max-w-[200px]">
              {room.description}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {room.threadCount > 0 && (
          <span className="text-xs text-gray-500">
            {t("userHome.threads", { count: room.threadCount })}
          </span>
        )}
        <ChevronRight className="w-5 h-5 text-gray-400" />
      </div>
    </Link>
  );
}
