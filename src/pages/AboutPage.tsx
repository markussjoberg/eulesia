import {
  ArrowLeft,
  Globe,
  Code,
  Users,
  Building2,
  Shield,
  Sparkles,
  BookOpen,
  Scale,
  Landmark,
  FlaskConical,
  ArrowRight,
  MapPin,
  Mail,
  GraduationCap,
  UserCheck,
  Coins,
  Fingerprint,
  MessageCircle,
  EyeOff,
  Lock,
  ShieldCheck,
  Handshake,
  HeartHandshake,
  Database,
  Unlink,
  Timer,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import { useAuth } from "../hooks/useAuth";

function PublicHeader() {
  const { t } = useTranslation("about");
  return (
    <header className="bg-blue-900 px-4 py-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center">
          <span className="text-blue-800 font-bold text-xl">E</span>
        </div>
        <span className="text-white font-semibold text-xl">Eulesia</span>
      </div>
      <Link
        to="/"
        className="text-blue-200 hover:text-white text-sm transition-colors"
      >
        {t("signIn")}
      </Link>
    </header>
  );
}

function SectionCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          {icon}
          {title}
        </h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function AboutContent() {
  const { t } = useTranslation("about");
  const { isAuthenticated } = useAuth();

  return (
    <>
      {/* Back navigation (only for authenticated users) */}
      {isAuthenticated && (
        <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3">
          <Link
            to="/profile"
            className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("back")}
          </Link>
        </div>
      )}

      {/* Spacer between nav and hero */}
      <div className="h-5 bg-gray-50 dark:bg-gray-900" />

      {/* Hero */}
      <div className="relative bg-blue-900 text-white rounded-2xl overflow-hidden mx-4">
        <img
          src="/eulesia-about-philosophers.jpg"
          alt=""
          aria-hidden="true"
          className="w-full"
        />
        <div className="absolute inset-0 bg-blue-900/65 px-4 py-8 flex flex-col justify-end">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center">
              <span className="text-blue-900 font-bold text-xl">E</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold">Eulesia</h1>
              <p className="text-blue-200 text-sm">{t("heroSubtitle")}</p>
            </div>
          </div>
          <p className="text-blue-100 leading-relaxed text-lg">
            {t("heroDescription")}
          </p>
          <div className="mt-4 self-start inline-flex items-center gap-2 bg-blue-900/60 text-blue-200 text-xs px-3 py-1.5 rounded-full">
            <Sparkles className="w-3 h-3" />
            {t("earlyStage")}
          </div>
        </div>
      </div>

      <div className="px-4 py-6 space-y-6">
        {/* Introduction — 3 paragraphs, no card wrapper */}
        <div className="space-y-4 py-2">
          <p className="text-gray-800 dark:text-gray-200 leading-relaxed">
            {t("intro.p1")}
          </p>
          <p className="text-gray-800 dark:text-gray-200 leading-relaxed">
            {t("intro.p2")}
          </p>
          <p className="text-gray-800 dark:text-gray-200 leading-relaxed">
            {t("intro.p3")}
          </p>
        </div>

        {/* Why is this needed? */}
        <SectionCard
          icon={<MessageCircle className="w-4 h-4 text-blue-600" />}
          title={t("problem.title")}
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {t("problem.p1")}
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {t("problem.p2")}
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {t("problem.p3")}
            </p>
          </div>
        </SectionCard>

        {/* How Eulesia differs — comparison matrix */}
        <SectionCard
          icon={<Scale className="w-4 h-4 text-blue-600" />}
          title={t("comparison.title")}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {t("comparison.description")}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 border border-gray-100 dark:border-gray-800">
                <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                  {t("comparison.quadrant1Title")}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {t("comparison.quadrant1Platforms")}
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5">
                  {t("comparison.quadrant1Desc")}
                </p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 border border-gray-100 dark:border-gray-800">
                <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                  {t("comparison.quadrant2Title")}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {t("comparison.quadrant2Platforms")}
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5">
                  {t("comparison.quadrant2Desc")}
                </p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 border border-gray-100 dark:border-gray-800">
                <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                  {t("comparison.quadrant3Title")}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {t("comparison.quadrant3Platforms")}
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5">
                  {t("comparison.quadrant3Desc")}
                </p>
              </div>
              <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                <p className="font-medium text-blue-900 text-sm">
                  {t("comparison.quadrant4Title")}
                </p>
                <p className="text-xs text-blue-700 mt-1.5">
                  {t("comparison.quadrant4Desc")}
                </p>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Subsidiarity */}
        <SectionCard
          icon={<Landmark className="w-4 h-4 text-blue-600" />}
          title={t("subsidiarity.title")}
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {t("subsidiarity.p1")}
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {t("subsidiarity.p2")}
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {t("subsidiarity.p3")}
            </p>
          </div>
        </SectionCard>

        {/* Four spaces */}
        <SectionCard
          icon={<Globe className="w-4 h-4 text-blue-600" />}
          title={t("fourSpaces.title")}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-2">
              {t("fourSpaces.description")}
            </p>

            <div className="flex gap-3">
              <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                <Landmark className="w-4 h-4 text-blue-700" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">
                  {t("fourSpaces.agora")}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {t("fourSpaces.agoraDesc")}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-8 h-8 bg-violet-100 dark:bg-violet-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                <Users className="w-4 h-4 text-violet-700" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">
                  {t("fourSpaces.clubs")}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {t("fourSpaces.clubsDesc")}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-8 h-8 bg-teal-100 dark:bg-teal-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                <Shield className="w-4 h-4 text-teal-700" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">
                  {t("fourSpaces.home")}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {t("fourSpaces.homeDesc")}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                <Building2 className="w-4 h-4 text-amber-700" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">
                  {t("fourSpaces.services")}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {t("fourSpaces.servicesDesc")}
                </p>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Design principles */}
        <SectionCard
          icon={<ShieldCheck className="w-4 h-4 text-blue-600" />}
          title={t("principles.title")}
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-2">
              {t("principles.description")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(
                [
                  { key: "identity", icon: <Fingerprint className="w-4 h-4" />, color: "text-blue-600 bg-blue-50 dark:bg-blue-900/20" },
                  { key: "institutional", icon: <Landmark className="w-4 h-4" />, color: "text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20" },
                  { key: "socialAgency", icon: <MessageCircle className="w-4 h-4" />, color: "text-violet-600 bg-violet-50 dark:bg-violet-900/20" },
                  { key: "noAttention", icon: <EyeOff className="w-4 h-4" />, color: "text-orange-600 bg-orange-50 dark:bg-orange-900/20" },
                  { key: "publicGovernance", icon: <Scale className="w-4 h-4" />, color: "text-teal-600 bg-teal-50 dark:bg-teal-900/20" },
                  { key: "privacy", icon: <Lock className="w-4 h-4" />, color: "text-green-600 bg-green-50 dark:bg-green-900/20" },
                ] as { key: string; icon: React.ReactNode; color: string }[]
              ).map(({ key, icon, color }) => (
                <div key={key} className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 flex gap-3">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
                    {icon}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                      {t(`principles.${key}`)}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      {t(`principles.${key}Desc`)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>

        {/* Automated content */}
        <SectionCard
          icon={<Sparkles className="w-4 h-4 text-blue-600" />}
          title={t("automated.title")}
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {t("automated.p1")}
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {t("automated.p2")}
            </p>
          </div>
        </SectionCard>

        {/* Who is Eulesia for? */}
        <SectionCard
          icon={<UserCheck className="w-4 h-4 text-blue-600" />}
          title={t("forWhom.title")}
        >
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                <Users className="w-4 h-4 text-blue-700" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">
                  {t("forWhom.citizens")}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {t("forWhom.citizensDesc")}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-8 h-8 bg-violet-100 dark:bg-violet-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                <Building2 className="w-4 h-4 text-violet-700" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">
                  {t("forWhom.municipalities")}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {t("forWhom.municipalitiesDesc")}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-8 h-8 bg-teal-100 dark:bg-teal-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                <GraduationCap className="w-4 h-4 text-teal-700" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">
                  {t("forWhom.researchers")}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {t("forWhom.researchersDesc")}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                <Code className="w-4 h-4 text-amber-700" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">
                  {t("forWhom.developers")}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {t("forWhom.developersDesc")}
                </p>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Research foundation */}
        <SectionCard
          icon={<FlaskConical className="w-4 h-4 text-blue-600" />}
          title={t("research.title")}
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {t("research.p1")}
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {t("research.p2")}
            </p>
            {t("research.paper") && (
              <p className="text-xs text-gray-500 dark:text-gray-400 italic mt-2 border-t border-gray-100 dark:border-gray-800 pt-3">
                {t("research.paper")}
              </p>
            )}
          </div>
        </SectionCard>

        {/* Open source */}
        <SectionCard
          icon={<Code className="w-4 h-4 text-blue-600" />}
          title={t("openSource.title")}
        >
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
            {t("openSource.description")}
          </p>
          <a
            href="https://github.com/Eulesia/eulesia"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:underline"
          >
            {t("openSource.viewOnGithub")}
          </a>
        </SectionCard>

        {/* EU alignment */}
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 flex items-center gap-3">
          <span className="text-3xl">🇪🇺</span>
          <div>
            <p className="font-medium text-blue-900">
              {t("euAlignment.title")}
            </p>
            <p className="text-sm text-blue-700 mt-1">
              {t("euAlignment.description")}
            </p>
          </div>
        </div>

        {/* Roadmap */}
        <SectionCard
          icon={<MapPin className="w-4 h-4 text-blue-600" />}
          title={t("roadmap.title")}
        >
          <div className="space-y-4">
            {(
              [
                { key: "now", active: true },
                { key: "q2", active: false },
                { key: "q3", active: false },
                { key: "q4", active: false },
                { key: "q1_2027", active: false },
                { key: "q2_2027", active: false },
              ] as { key: string; active: boolean }[]
            ).map(({ key, active }) => (
              <div
                key={key}
                className={`relative pl-6 border-l-2 ${active ? "border-blue-500" : "border-gray-200 dark:border-gray-800"}`}
              >
                <div
                  className={`absolute -left-[7px] top-0.5 w-3 h-3 rounded-full ${active ? "bg-blue-500" : "bg-gray-300"}`}
                />
                <h3
                  className={`font-medium text-sm ${active ? "text-blue-900 dark:text-blue-300" : "text-gray-700 dark:text-gray-300"}`}
                >
                  {t(`roadmap.${key}`)}
                </h3>
                <ul className="mt-1.5 space-y-1">
                  {(
                    t(`roadmap.${key}Items`, {
                      returnObjects: true,
                    }) as string[]
                  ).map((item, i) => (
                    <li
                      key={i}
                      className="text-sm text-gray-600 dark:text-gray-400 flex items-start gap-2"
                    >
                      <span
                        className={`mt-1 flex-shrink-0 ${active ? "text-blue-400" : "text-gray-400"}`}
                      >
                        •
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Founders */}
        <SectionCard
          icon={<Users className="w-4 h-4 text-blue-600" />}
          title={t("founders.title")}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {t("founders.description")}
            </p>

            {/* Origin story */}
            <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 border border-blue-100 dark:border-blue-800/40">
              <Handshake className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-blue-800 dark:text-blue-200 leading-relaxed">
                {t("founders.origin")}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Markus */}
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-blue-700 text-sm">
                    MS
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                      {t("founders.markus")}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                      <GraduationCap className="w-3 h-3" />
                      {t("founders.markusRole")}
                    </p>
                  </div>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t("founders.markusDesc")}
                </p>
              </div>

              {/* Julius */}
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-violet-100 dark:bg-violet-900/30 rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-violet-700 text-sm">
                    JK
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                      {t("founders.julius")}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                      <Code className="w-3 h-3" />
                      {t("founders.juliusRole")}
                    </p>
                  </div>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t("founders.juliusDesc")}
                </p>
              </div>
            </div>

            <a
              href="mailto:info@eulesia.eu"
              className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline pt-1"
            >
              <Mail className="w-4 h-4" />
              {t("founders.contact")}
            </a>
          </div>
        </SectionCard>

        {/* Foundation / Legal entity — prominent call for founding donor */}
        <div className="rounded-xl border-2 border-amber-300 dark:border-amber-600/50 overflow-hidden">
          {/* Header */}
          <div className="bg-amber-50 dark:bg-amber-900/30 px-4 py-3 border-b border-amber-200 dark:border-amber-700/40 flex items-center justify-between gap-3">
            <h2 className="font-semibold text-amber-900 dark:text-amber-100 flex items-center gap-2">
              <HeartHandshake className="w-4 h-4 text-amber-600" />
              {t("foundation.title")}
            </h2>
            <span className="inline-flex items-center gap-1.5 bg-amber-500 text-white text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0">
              <Sparkles className="w-3 h-3" />
              {t("foundation.badge")}
            </span>
          </div>

          {/* Body */}
          <div className="bg-amber-50/40 dark:bg-amber-900/10 p-4 space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
                {t("foundation.p1")}
              </p>
              <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
                {t("foundation.p2")}
              </p>
              <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed font-medium">
                {t("foundation.p3")}
              </p>
            </div>

            {/* Three reasons */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(
                [
                  { key: "why1", icon: <Database className="w-4 h-4" />, color: "text-amber-700 bg-amber-100 dark:bg-amber-800/30 dark:text-amber-300" },
                  { key: "why2", icon: <Unlink className="w-4 h-4" />, color: "text-amber-700 bg-amber-100 dark:bg-amber-800/30 dark:text-amber-300" },
                  { key: "why3", icon: <Timer className="w-4 h-4" />, color: "text-amber-700 bg-amber-100 dark:bg-amber-800/30 dark:text-amber-300" },
                ] as { key: string; icon: React.ReactNode; color: string }[]
              ).map(({ key, icon, color }) => (
                <div key={key} className="bg-white dark:bg-gray-900/60 rounded-lg p-3 border border-amber-200 dark:border-amber-700/30">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2 ${color}`}>
                    {icon}
                  </div>
                  <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                    {t(`foundation.${key}Title`)}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    {t(`foundation.${key}Desc`)}
                  </p>
                </div>
              ))}
            </div>

            {/* CTA */}
            <div className="flex items-center gap-3 bg-white dark:bg-gray-900/60 rounded-lg px-4 py-3 border border-amber-200 dark:border-amber-700/30">
              <Mail className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {t("foundation.contact")}{" "}
                <a
                  href="mailto:info@eulesia.eu"
                  className="font-semibold text-amber-700 dark:text-amber-400 hover:underline"
                >
                  {t("foundation.contactEmail")}
                </a>
              </p>
            </div>
          </div>
        </div>

        {/* Funding */}
        <SectionCard
          icon={<Coins className="w-4 h-4 text-blue-600" />}
          title={t("funding.title")}
        >
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
            {t("funding.description")}
          </p>
          <ul className="space-y-1">
            {(t("funding.items", { returnObjects: true }) as string[]).map(
              (item, i) => (
                <li
                  key={i}
                  className="text-sm text-gray-600 dark:text-gray-400 flex items-start gap-2"
                >
                  <span className="text-blue-400 mt-1 flex-shrink-0">•</span>
                  {item}
                </li>
              ),
            )}
          </ul>
        </SectionCard>

        {/* CTA for non-authenticated */}
        {!isAuthenticated && (
          <div className="bg-blue-900 rounded-xl p-5 text-center">
            <h3 className="text-white font-semibold mb-2">{t("cta.title")}</h3>
            <p className="text-blue-200 text-sm mb-4">{t("cta.description")}</p>
            <Link
              to="/"
              className="inline-flex items-center gap-2 bg-white text-blue-900 px-5 py-2.5 rounded-xl font-medium text-sm hover:bg-blue-50 transition-colors"
            >
              {t("cta.button")}
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

export function AboutPage() {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return (
      <Layout>
        <SEOHead
          title="Tietoa Eulesiasta"
          description="Eulesia on eurooppalainen kansalaisdemokratia-alusta, joka yhdistää kansalaiset, kunnat ja instituutiot."
          path="/about"
          jsonLd={{
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "Eulesia",
            url: "https://eulesia.eu",
            description: "Eurooppalainen kansalaisdemokratia-alusta",
          }}
        />
        <AboutContent />
      </Layout>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-800/50">
      <PublicHeader />
      <div className="max-w-4xl mx-auto">
        <AboutContent />
      </div>
    </div>
  );
}
