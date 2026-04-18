import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Shield, ArrowLeft } from "lucide-react";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import { useAuth } from "../hooks/useAuth";

function PublicHeader() {
  return (
    <div className="bg-blue-900 text-white py-4 px-4">
      <div className="max-w-4xl mx-auto flex items-center gap-3">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
            <span className="text-blue-800 font-bold text-lg">E</span>
          </div>
          <span className="font-bold text-lg">Eulesia</span>
        </Link>
      </div>
    </div>
  );
}

function PrivacyContent() {
  const { t } = useTranslation("legal");

  const sectionKeys = [
    "intro",
    "data_collected",
    "purpose",
    "legal_basis",
    "ai_classification",
    "sharing",
    "retention",
    "rights",
    "security",
    "cookies",
    "changes",
    "contact",
  ];

  const listSections = ["data_collected", "purpose", "rights"];

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <Link
        to="/about"
        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        {t("common:actions.back")}
      </Link>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            {t("privacy.title")}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {t("privacy.lastUpdated", { date: "18.4.2026" })}
          </p>
        </div>

        <div className="p-6 space-y-6">
          {sectionKeys.map((key) => (
            <section key={key}>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">
                {t(`privacy.sections.${key}.title`)}
              </h2>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">
                {t(`privacy.sections.${key}.content`)}
              </p>
              {listSections.includes(key) && (
                <ul className="mt-2 space-y-1">
                  {(
                    t(`privacy.sections.${key}.items`, {
                      returnObjects: true,
                    }) as string[]
                  ).map((item, i) => (
                    <li
                      key={i}
                      className="text-sm text-gray-700 flex items-start gap-2"
                    >
                      <span className="text-blue-500 mt-0.5">•</span>
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>

      <div className="mt-6 text-center">
        <Link to="/terms" className="text-sm text-blue-600 hover:underline">
          ← {t("terms.title")}
        </Link>
      </div>
    </div>
  );
}

export function PrivacyPage() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <PublicHeader />
        <PrivacyContent />
      </div>
    );
  }

  return (
    <Layout>
      <SEOHead
        title="Tietosuojaseloste"
        description="Eulesia-alustan tietosuojaseloste. Lue miten käsittelemme henkilötietojasi."
        path="/privacy"
      />
      <PrivacyContent />
    </Layout>
  );
}
