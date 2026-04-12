//! Static list of configured minute sources.
//!
//! Ported from the old Node.js importer's static tables (CLOUDNC_SOURCES,
//! DYNASTY_SOURCES, TWEB_SOURCES) in commit `3b0bda7`, plus the new
//! M-Files entries for Etelä-Karjala (Lappeenranta, Imatra, …).
//!
//! The adaptive / DB-backed scraper configs come later in phase 3.

use crate::fetchers::{FetcherType, MinuteSource};

/// Helper for the `mfiles.<slug>.fi/Kokoukset/<slug>` pattern.
fn mfiles_fi(slug: &str, entity_name: &str) -> MinuteSource {
    MinuteSource {
        entity_name: entity_name.to_string(),
        slug: slug.to_string(),
        fetcher_type: FetcherType::MFiles,
        url: format!("https://mfiles.{slug}.fi/Kokoukset/{slug}"),
        country: "FI".to_string(),
        language: "fi".to_string(),
        region: None,
        path_prefix: None,
    }
}

/// Helper for a basic CloudNC municipality site.
fn cloudnc(slug: &str, entity_name: &str) -> MinuteSource {
    MinuteSource {
        entity_name: entity_name.to_string(),
        slug: slug.to_string(),
        fetcher_type: FetcherType::CloudNc,
        url: format!("https://{slug}.cloudnc.fi/fi-FI"),
        country: "FI".to_string(),
        language: "fi".to_string(),
        region: None,
        path_prefix: None,
    }
}

/// Helper for a CloudNC welfare region (custom subdomain + region label).
fn cloudnc_region(subdomain: &str, region_name: &str) -> MinuteSource {
    MinuteSource {
        entity_name: region_name.to_string(),
        slug: subdomain.to_string(),
        fetcher_type: FetcherType::CloudNc,
        url: format!("https://{subdomain}.cloudnc.fi/fi-FI"),
        country: "FI".to_string(),
        language: "fi".to_string(),
        region: Some(region_name.to_string()),
        path_prefix: None,
    }
}

/// Helper for a Dynasty site at `poytakirjat.<slug>.fi/cgi/DREQUEST.PHP`
/// (no path prefix).
fn dynasty_poytakirjat(slug: &str, entity_name: &str) -> MinuteSource {
    MinuteSource {
        entity_name: entity_name.to_string(),
        slug: slug.to_string(),
        fetcher_type: FetcherType::Dynasty,
        url: format!("https://poytakirjat.{slug}.fi/cgi/DREQUEST.PHP"),
        country: "FI".to_string(),
        language: "fi".to_string(),
        region: None,
        path_prefix: None,
    }
}

/// Helper for an arbitrary Dynasty URL with an explicit path prefix.
fn dynasty_custom(
    slug: &str,
    entity_name: &str,
    url: String,
    path_prefix: Option<String>,
) -> MinuteSource {
    MinuteSource {
        entity_name: entity_name.to_string(),
        slug: slug.to_string(),
        fetcher_type: FetcherType::Dynasty,
        url,
        country: "FI".to_string(),
        language: "fi".to_string(),
        region: None,
        path_prefix,
    }
}

/// Helper for a Tweb site. The URL must be the full Pöytäkirjat listing
/// page — both the older `/ktwebbin/dbisa.dll/ktwebscr/pk_tek_tweb.htm`
/// layout and the newer `/ktwebscr/pk_tek_tweb.htm` layout are supported;
/// [`crate::fetchers::TwebFetcher`] derives the POST endpoint and agenda
/// base from whichever URL is given here.
fn tweb(slug: &str, entity_name: &str, listing_url: &str) -> MinuteSource {
    MinuteSource {
        entity_name: entity_name.to_string(),
        slug: slug.to_string(),
        fetcher_type: FetcherType::Tweb,
        url: listing_url.to_string(),
        country: "FI".to_string(),
        language: "fi".to_string(),
        region: None,
        path_prefix: None,
    }
}

/// Helper for a generic HTML page listing PDF download links.
fn generic_pdf(slug: &str, entity_name: &str, listing_url: &str) -> MinuteSource {
    MinuteSource {
        entity_name: entity_name.to_string(),
        slug: slug.to_string(),
        fetcher_type: FetcherType::GenericPdf,
        url: listing_url.to_string(),
        country: "FI".to_string(),
        language: "fi".to_string(),
        region: None,
        path_prefix: None,
    }
}

/// Helper for a WordPress site that exposes /wp-json/wp/v2/media.
fn wordpress(slug: &str, entity_name: &str, site_url: &str) -> MinuteSource {
    MinuteSource {
        entity_name: entity_name.to_string(),
        slug: slug.to_string(),
        fetcher_type: FetcherType::WordPress,
        url: site_url.to_string(),
        country: "FI".to_string(),
        language: "fi".to_string(),
        region: None,
        path_prefix: None,
    }
}

/// Return the full list of configured sources.
pub fn all_sources() -> Vec<MinuteSource> {
    let mut sources = Vec::new();
    sources.extend(mfiles_sources());
    sources.extend(cloudnc_sources());
    sources.extend(generic_pdf_sources());
    sources.extend(wordpress_sources());
    sources.extend(dynasty_sources());
    sources.extend(tweb_sources());
    sources
}

// ---------------------------------------------------------------------------
// M-Files
// ---------------------------------------------------------------------------

/// M-Files entries. Phase 2 focuses on Etelä-Karjala where the system is
/// actually in use. Expand as we confirm more hosts.
pub fn mfiles_sources() -> Vec<MinuteSource> {
    vec![
        mfiles_fi("lappeenranta", "Lappeenranta"),
        mfiles_fi("imatra", "Imatra"),
    ]
}

// ---------------------------------------------------------------------------
// CloudNC
// ---------------------------------------------------------------------------

pub fn cloudnc_sources() -> Vec<MinuteSource> {
    let municipalities = [
        ("rautalampi", "Rautalampi"),
        ("tampere", "Tampere"),
        ("jyvaskyla", "Jyväskylä"),
        ("mikkeli", "Mikkeli"),
        ("rovaniemi", "Rovaniemi"),
        ("kajaani", "Kajaani"),
        ("pori", "Pori"),
        ("hollola", "Hollola"),
        ("tuusula", "Tuusula"),
        ("jarvenpaa", "Järvenpää"),
        ("laitila", "Laitila"),
        ("laihia", "Laihia"),
        ("kangasniemi", "Kangasniemi"),
        ("muonio", "Muonio"),
        ("aura", "Aura"),
        ("vesilahti", "Vesilahti"),
        ("mantyharju", "Mäntyharju"),
        ("hameenkyro", "Hämeenkyrö"),
        ("enontekio", "Enontekiö"),
        // Batch 2
        ("kempele", "Kempele"),
        ("lapua", "Lapua"),
        // Batch 3
        ("padasjoki", "Padasjoki"),
        ("puumala", "Puumala"),
        ("rusko", "Rusko"),
    ];

    let welfare_regions = [
        ("pirha", "Pirkanmaan hyvinvointialue"),
        ("pohde", "Pohjois-Pohjanmaan hyvinvointialue"),
        ("sata", "Satakunnan hyvinvointialue"),
        ("itauusimaa", "Itä-Uusimaan hyvinvointialue"),
        ("keuh", "Keski-Uusimaan hyvinvointialue"),
        ("vakehyva", "Vantaan ja Keravan hyvinvointialue"),
        ("kainuunhyvinvointialue", "Kainuun hyvinvointialue"),
    ];

    municipalities
        .iter()
        .map(|(slug, name)| cloudnc(slug, name))
        .chain(
            welfare_regions
                .iter()
                .map(|(sub, name)| cloudnc_region(sub, name)),
        )
        .collect()
}

// ---------------------------------------------------------------------------
// Dynasty
// ---------------------------------------------------------------------------

pub fn dynasty_sources() -> Vec<MinuteSource> {
    let mut sources = Vec::new();

    // --- Direct poytakirjat.<slug>.fi sites ---
    let poytakirjat = [
        ("ylivieska", "Ylivieska"),
        ("haapavesi", "Haapavesi"),
        ("merijarvi", "Merijärvi"),
        ("mynamaki", "Mynämäki"),
        ("nivala", "Nivala"),
        ("nousiainen", "Nousiainen"),
        ("oulainen", "Oulainen"),
        ("savukoski", "Savukoski"),
        ("siikajoki", "Siikajoki"),
        ("utsjoki", "Utsjoki"),
        ("vantaa", "Vantaa"),
    ];
    for (slug, name) in poytakirjat {
        sources.push(dynasty_poytakirjat(slug, name));
    }

    // --- poytakirjat.<slug>.fi with a D10_ prefix ---
    sources.push(dynasty_custom(
        "haapajarvi",
        "Haapajärvi",
        "https://poytakirjat.haapajarvi.fi/cgi/DREQUEST.PHP".to_string(),
        Some("/D10_Haapajarvi".to_string()),
    ));

    // --- Custom domain with djulkaisu prefix ---
    sources.push(dynasty_custom(
        "suonenjoki",
        "Suonenjoki",
        "https://www.suonenjoki.info/djulkaisu/cgi/DREQUEST.PHP".to_string(),
        Some("/djulkaisu".to_string()),
    ));

    // --- Kaustisen seutukunta: dynastyjulkaisu.kase.fi/D10_<slug>/... ---
    for (slug, name) in [
        ("toholampi", "Toholampi"),
        ("kaustinen", "Kaustinen"),
        ("perho", "Perho"),
        ("veteli", "Veteli"),
    ] {
        let cap = capitalize_first(slug);
        let prefix = format!("/D10_{cap}");
        let url = format!("https://dynastyjulkaisu.kase.fi{prefix}/cgi/DREQUEST.PHP");
        sources.push(dynasty_custom(slug, name, url, Some(prefix)));
    }

    // --- dynasty.<slug>.fi/djulkaisu ---
    for (slug, name) in [("rautavaara", "Rautavaara"), ("vesanto", "Vesanto")] {
        let url = format!("https://dynasty.{slug}.fi/djulkaisu/cgi/DREQUEST.PHP");
        sources.push(dynasty_custom(
            slug,
            name,
            url,
            Some("/djulkaisu".to_string()),
        ));
    }

    // --- www.<slug>.fi/djulkaisu ---
    for (slug, name) in [
        ("brando", "Brändo"),
        ("evijarvi", "Evijärvi"),
        ("hartola", "Hartola"),
        ("kristiinankaupunki", "Kristiinankaupunki"),
    ] {
        let url = format!("https://www.{slug}.fi/djulkaisu/cgi/DREQUEST.PHP");
        sources.push(dynasty_custom(
            slug,
            name,
            url,
            Some("/djulkaisu".to_string()),
        ));
    }

    // --- Pohjois-Karjala: dynastyjulkaisu.pohjoiskarjala.net/<Kunta>/... ---
    for (slug_cased, entity) in [
        ("Joensuu", "Joensuu"),
        ("Lieksa", "Lieksa"),
        ("Nurmes", "Nurmes"),
        ("Outokumpu", "Outokumpu"),
        ("Kitee", "Kitee"),
        ("Kontiolahti", "Kontiolahti"),
        ("Liperi", "Liperi"),
        ("Juuka", "Juuka"),
        ("Ilomantsi", "Ilomantsi"),
        ("Tohmajarvi", "Tohmajärvi"),
        ("Polvijarvi", "Polvijärvi"),
        ("Raakkyla", "Rääkkylä"),
        ("Heinavesi", "Heinävesi"),
    ] {
        let prefix = format!("/{slug_cased}");
        let url = format!("https://dynastyjulkaisu.pohjoiskarjala.net{prefix}/cgi/DREQUEST.PHP");
        sources.push(dynasty_custom(
            &slug_cased.to_lowercase(),
            entity,
            url,
            Some(prefix),
        ));
    }

    // --- OnCloudOS-hosted Dynasty: <slug>.oncloudos.com ---
    // These use the standard DREQUEST.PHP interface with no path prefix.
    for (slug, name) in [
        ("askola", "Askola"),
        ("espoo", "Espoo"),
        ("eurajoki", "Eurajoki"),
        ("forssa", "Forssa"),
        ("hailuoto", "Hailuoto"),
        ("ii", "Ii"),
        ("inari", "Inari"),
        ("joroinen", "Joroinen"),
        ("juva", "Juva"),
        // Batch 2 additions
        ("kemi", "Kemi"),
        ("kemijarvi", "Kemijärvi"),
        ("keuruu", "Keuruu"),
        ("kirkkonummi", "Kirkkonummi"),
        ("kuhmoinen", "Kuhmoinen"),
        ("kuopio", "Kuopio"),
        ("lahti", "Lahti"),
        ("laukaa", "Laukaa"),
        ("karkola", "Kärkölä"),
        // Batch 3 additions
        ("liminka", "Liminka"),
        ("luhanka", "Luhanka"),
        ("lumijoki", "Lumijoki"),
        ("naantali", "Naantali"),
        ("nakkila", "Nakkila"),
        ("palkane", "Pälkäne"),
        ("parainen", "Parainen"),
        ("pudasjarvi", "Pudasjärvi"),
        ("rantasalmi", "Rantasalmi"),
        ("ranua", "Ranua"),
        ("ruovesi", "Ruovesi"),
        ("savonlinna", "Savonlinna"),
        ("simo", "Simo"),
        ("tornio", "Tornio"),
        ("tyrnava", "Tyrnävä"),
        ("utajarvi", "Utajärvi"),
        ("uusikaupunki", "Uusikaupunki"),
        ("vaala", "Vaala"),
        ("vihti", "Vihti"),
    ] {
        let url = format!("https://{slug}.oncloudos.com/cgi/DREQUEST.PHP");
        sources.push(dynasty_custom(slug, name, url, None));
    }

    // OnCloudOS with "<slug>10" or "<slug>d10" subdomain variations.
    for (host, slug, name) in [
        ("asikkalad10", "asikkala", "Asikkala"),
        ("enonkoskid10", "enonkoski", "Enonkoski"),
        ("eura10", "eura", "Eura"),
        ("hanko10fi", "hanko", "Hanko"),
        ("harjavalta10", "harjavalta", "Harjavalta"),
        ("hyrynsalmi10", "hyrynsalmi", "Hyrynsalmi"),
        ("jamsa10", "jamsa", "Jämsä"),
        ("kaavi10", "kaavi", "Kaavi"),
        ("kannus10", "kannus", "Kannus"),
        // Batch 2
        ("kauniainen10fi", "kauniainen", "Kauniainen"),
        ("karkkilad10", "karkkila", "Karkkila"),
        ("kokkola10", "kokkola", "Kokkola"),
        ("kuhmo10", "kuhmo", "Kuhmo"),
        ("kuortaned10", "kuortane", "Kuortane"),
        // Batch 3
        ("lempaala10", "lempaala", "Lempäälä"),
        ("loimaad10", "loimaa", "Loimaa"),
        ("mantsalad10", "mantsala", "Mäntsälä"),
        ("muhosd10", "muhos", "Muhos"),
        ("nurmijarvi10", "nurmijarvi", "Nurmijärvi"),
        ("orimattilad10", "orimattila", "Orimattila"),
        ("orivesid10", "orivesi", "Orivesi"),
        ("paltamo10", "paltamo", "Paltamo"),
        ("parkanod10", "parkano", "Parkano"),
        ("poytyad10", "poytya", "Pöytyä"),
        ("punkalaidun10", "punkalaidun", "Punkalaidun"),
        ("puolanka10", "puolanka", "Puolanka"),
        ("pyhtaa10", "pyhtaa", "Pyhtää"),
        ("raahe10", "raahe", "Raahe"),
        ("ristijarvi10", "ristijarvi", "Ristijärvi"),
        ("sakylad10", "sakyla", "Säkylä"),
        ("salo10", "salo", "Salo"),
        ("sastamalad10", "sastamala", "Sastamala"),
        ("siikalatvad10", "siikalatva", "Siikalatva"),
        ("siilinjarvi10", "siilinjarvi", "Siilinjärvi"),
        ("sotkamod10", "sotkamo", "Sotkamo"),
        ("suomussalmi10", "suomussalmi", "Suomussalmi"),
        ("sysmad10", "sysma", "Sysmä"),
        ("tammela10", "tammela", "Tammela"),
        ("tuusniemid10", "tuusniemi", "Tuusniemi"),
        ("ylojarvi10", "ylojarvi", "Ylöjärvi"),
    ] {
        let url = format!("https://{host}.oncloudos.com/cgi/DREQUEST.PHP");
        sources.push(dynasty_custom(slug, name, url, None));
    }

    // --- Custom Dynasty hosts (non-OnCloudOS, non-poytakirjat) ---
    sources.push(dynasty_custom(
        "alavieska",
        "Alavieska",
        "https://poytakirjat.alavieska.fi/D10_Alavieska/cgi/DREQUEST.PHP".to_string(),
        Some("/D10_Alavieska".to_string()),
    ));
    sources.push(dynasty_custom(
        "heinola",
        "Heinola",
        "https://kokoukset.heinola.fi/dynasty2025/cgi/DREQUEST.PHP".to_string(),
        Some("/dynasty2025".to_string()),
    ));
    sources.push(dynasty_custom(
        "iitti",
        "Iitti",
        "https://dynasty10.iitti.fi/cgi/DREQUEST.PHP".to_string(),
        None,
    ));
    sources.push(dynasty_custom(
        "kalajoki",
        "Kalajoki",
        "https://www4.kalajoki.fi/djulkaisu/cgi/DREQUEST.PHP".to_string(),
        Some("/djulkaisu".to_string()),
    ));
    sources.push(dynasty_custom(
        "kankaanpaa",
        "Kankaanpää",
        "https://djulkaisu.kankaanpaa.fi/D10_Kankaanpaa/cgi/DREQUEST.PHP".to_string(),
        Some("/D10_Kankaanpaa".to_string()),
    ));
    // Batch 2 custom
    sources.push(dynasty_poytakirjat("karsamaki", "Kärsämäki"));
    sources.push(dynasty_poytakirjat("kemionsaari", "Kemiönsaari"));
    // User-provided custom
    sources.push(dynasty_custom(
        "lohja",
        "Lohja",
        "https://dynasty.lohja.fi/d10julkaisu/cgi/DREQUEST.PHP".to_string(),
        Some("/d10julkaisu".to_string()),
    ));
    sources.push(dynasty_custom(
        "kouvola",
        "Kouvola",
        "https://ep10.kouvola.fi/cgi/DREQUEST.PHP".to_string(),
        None,
    ));
    sources.push(dynasty_custom(
        "kinnula",
        "Kinnula",
        "https://julkaisu.kinnula.fi/kinnula10/cgi/DREQUEST.PHP".to_string(),
        Some("/kinnula10".to_string()),
    ));
    sources.push(dynasty_custom(
        "kittila",
        "Kittilä",
        "https://dynasty10.kittila.fi/cgi/DREQUEST.PHP".to_string(),
        None,
    ));
    sources.push(dynasty_custom(
        "kyyjarvi",
        "Kyyjärvi",
        "https://kokous.kyyjarvi.fi/Kyyjulk/cgi/DREQUEST.PHP".to_string(),
        Some("/Kyyjulk".to_string()),
    ));
    sources.push(dynasty_custom(
        "lapinlahti",
        "Lapinlahti",
        "https://dynasty.lapinlahti.fi/Internet/cgi/DREQUEST.PHP".to_string(),
        Some("/Internet".to_string()),
    ));
    sources.push(dynasty_custom(
        "loviisa",
        "Loviisa",
        "https://loviisa.oncloudos.com/fi/cgi/DREQUEST.PHP".to_string(),
        Some("/fi".to_string()),
    ));
    sources.push(dynasty_custom(
        "luumaki",
        "Luumäki",
        "https://dynastyjulkaisu.luumaki.fi/cgi/DREQUEST.PHP".to_string(),
        None,
    ));
    sources.push(dynasty_custom(
        "miehikkala",
        "Miehikkälä",
        "https://www.miehikkala.fi/D10_Miehijulk/cgi/DREQUEST.PHP".to_string(),
        Some("/D10_Miehijulk".to_string()),
    ));
    sources.push(dynasty_custom(
        "pelkosenniemi",
        "Pelkosenniemi",
        "https://paatoksetd10.pelkosenniemi.fi/cgi/DREQUEST.PHP".to_string(),
        None,
    ));
    sources.push(dynasty_custom(
        "pyhajoki",
        "Pyhäjoki",
        "https://poytakirjat.pyhajoki.fi/D10_Pyhajoki/cgi/DREQUEST.PHP".to_string(),
        Some("/D10_Pyhajoki".to_string()),
    ));
    sources.push(dynasty_custom(
        "pyhajarvi",
        "Pyhäjärvi",
        "https://poytakirjat.pyhajarvi.fi/djulkaisu/cgi/DREQUEST.PHP".to_string(),
        Some("/djulkaisu".to_string()),
    ));
    sources.push(dynasty_custom(
        "pyhanta",
        "Pyhäntä",
        "https://poytakirjat.pyhanta.fi/D10_Pyhanta/cgi/DREQUEST.PHP".to_string(),
        Some("/D10_Pyhanta".to_string()),
    ));
    sources.push(dynasty_custom(
        "raisio",
        "Raisio",
        "https://julkaisut.raisio.fi/dynasty10/cgi/DREQUEST.PHP".to_string(),
        Some("/dynasty10".to_string()),
    ));
    sources.push(dynasty_custom(
        "rautjarvi",
        "Rautjärvi",
        "https://dynastyjulkaisu.rautjarvi.fi/cgi/DREQUEST.PHP".to_string(),
        None,
    ));
    sources.push(dynasty_custom(
        "reisjarvi",
        "Reisjärvi",
        "https://poytakirjat.reisjarvi.fi/D10_Reisjarvi/cgi/DREQUEST.PHP".to_string(),
        Some("/D10_Reisjarvi".to_string()),
    ));
    sources.push(dynasty_custom(
        "ruokolahti",
        "Ruokolahti",
        "https://dynastyjulkaisu.ruokolahti.fi/cgi/DREQUEST.PHP".to_string(),
        None,
    ));
    sources.push(dynasty_custom(
        "savitaipale",
        "Savitaipale",
        "https://dynastyjulkaisu.savitaipale.fi/cgi/DREQUEST.PHP".to_string(),
        None,
    ));
    sources.push(dynasty_custom(
        "sonkajarvi",
        "Sonkajärvi",
        "https://dynasty.sonkajarvi.fi/D10_SonkaInternet/cgi/DREQUEST.PHP".to_string(),
        Some("/D10_SonkaInternet".to_string()),
    ));
    sources.push(dynasty_custom(
        "taipalsaari",
        "Taipalsaari",
        "https://dynastyjulkaisu.taipalsaari.fi/cgi/DREQUEST.PHP".to_string(),
        None,
    ));
    sources.push(dynasty_custom(
        "ulvila",
        "Ulvila",
        "https://paatos.ulvila.fi/cgi/DREQUEST.PHP".to_string(),
        None,
    ));
    sources.push(dynasty_custom(
        "viitasaari",
        "Viitasaari",
        "https://julkaisu.viitasaari.fi/viitasaari10/cgi/DREQUEST.PHP".to_string(),
        Some("/viitasaari10".to_string()),
    ));
    sources.push(dynasty_custom(
        "virrat",
        "Virrat",
        "https://dynastyjulkaisu.virrat.fi/cgi/DREQUEST.PHP".to_string(),
        None,
    ));
    sources.push(dynasty_custom(
        "aanekoski",
        "Äänekoski",
        "https://web28.aanekoski.fi/dynasty10/cgi/DREQUEST.PHP".to_string(),
        Some("/dynasty10".to_string()),
    ));

    sources
}

fn capitalize_first(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

// ---------------------------------------------------------------------------
// Tweb
// ---------------------------------------------------------------------------

pub fn tweb_sources() -> Vec<MinuteSource> {
    vec![
        // --- <slug>.tweb.fi direct ---
        tweb(
            "uurainen",
            "Uurainen",
            "https://uurainen.tweb.fi/ktwebbin/dbisa.dll/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "ikaalinen",
            "Ikaalinen",
            "https://ikaalinen.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "akaa",
            "Akaa",
            "https://akaa.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "hameenlinna",
            "Hämeenlinna",
            "https://hameenlinna.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "hankasalmi",
            "Hankasalmi",
            "https://hankasalmi.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "hausjarvi",
            "Hausjärvi",
            "https://hausjarvi.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "humppila",
            "Humppila",
            "https://humppila.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "isokyro",
            "Isokyrö",
            "https://isokyro.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "janakkala",
            "Janakkala",
            "https://janakkala.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "kangasala",
            "Kangasala",
            "https://kangasala.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        // --- <slug>-julkaisu.tweb.fi ---
        tweb(
            "halsua",
            "Halsua",
            "https://halsua-julkaisu.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "ilmajoki",
            "Ilmajoki",
            "https://ilmajoki-julkaisu.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "jamijarvi",
            "Jämijärvi",
            "https://jamijarvi-julkaisu.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        // --- <slug>-julkaisu.triplancloud.fi ---
        tweb(
            "alavus",
            "Alavus",
            "https://alavus-julkaisu.triplancloud.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "hamina",
            "Hamina",
            "https://hamina-julkaisu.triplancloud.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "hattula",
            "Hattula",
            "https://hattula-julkaisu.triplancloud.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "huittinen",
            "Huittinen",
            "https://huittinen-julkaisu.triplancloud.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "jokioinen",
            "Jokioinen",
            "https://jokioinen-julkaisu.triplancloud.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        // --- Custom subdomains ---
        tweb(
            "kaarina",
            "Kaarina",
            "https://tweb.kaarina.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "iisalmi",
            "Iisalmi",
            "https://julkaisu.iisalmi.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "alajarvi",
            "Alajärvi",
            "https://tweb.alajarvi.fi/ktwebbin/dbisa.dll/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "hyvinkaa",
            "Hyvinkää",
            "https://asianhallintavhp.hyvinkaa.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "inkoo",
            "Inkoo",
            "https://paatokset.inga.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        // --- Custom hostnames ---
        tweb(
            "oulu",
            "Oulu",
            "https://asiakirjat.ouka.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "multia",
            "Multia",
            "http://multia.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "petajavesi",
            "Petäjävesi",
            "https://kuulutukset.petajavesi.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "raasepori",
            "Raasepori",
            "https://raseborg-julkaisu.triplancloud.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "somero",
            "Somero",
            "https://asianhallinta.somero.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "seinajoki",
            "Seinäjoki",
            "https://listat.seinajoki.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "urjala",
            "Urjala",
            "http://urjala.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "vimpeli",
            "Vimpeli",
            "http://tweb.vimpeli.fi/ktwebbin/dbisa.dll/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "ahtari",
            "Ähtäri",
            "https://kuntatoimisto.ahtari.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "turku",
            "Turku",
            "https://ah.turku.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        // --- seutupalvelukeskus.fi ---
        tweb(
            "isojoki",
            "Isojoki",
            "https://tweb-isojoki.seutupalvelukeskus.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "karijoki",
            "Karijoki",
            "https://tweb-karijoki.seutupalvelukeskus.fi/ktwebbin/dbisa.dll/ktwebscr/pk_tek_tweb.htm",
        ),
        // --- Batch 2 additions ---
        tweb(
            "karvia",
            "Karvia",
            "https://karvia-julkaisu.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "kaskinen",
            "Kaskinen",
            "https://kaskinen-julkaisu.triplancloud.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "kauhajoki",
            "Kauhajoki",
            "https://kauhajoki-julkaisu.triplancloud.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "keminmaa",
            "Keminmaa",
            "https://keminmaa.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "kerava",
            "Kerava",
            "https://kerava-julkaisu.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "kolari",
            "Kolari",
            "https://kolari.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "konnevesi",
            "Konnevesi",
            "https://konnevesi-julkaisu.triplancloud.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "korsnas",
            "Korsnäs",
            "https://korsnas.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "kurikka",
            "Kurikka",
            "https://kurikka-julkaisu.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "kuusamo",
            "Kuusamo",
            "https://kuusamo.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "lapinjarvi",
            "Lapinjärvi",
            "https://lapinjarvi-julkaisu.triplancloud.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        // --- Batch 3 additions ---
        tweb(
            "leppavirta",
            "Leppävirta",
            "https://leppavirta.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "lieto",
            "Lieto",
            "https://lieto-julkaisu.triplancloud.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "loppi",
            "Loppi",
            "https://loppi.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "luoto",
            "Luoto",
            "https://luoto-julkaisu.triplancloud.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "masku",
            "Masku",
            "https://masku.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "merikarvia",
            "Merikarvia",
            "https://merikarvia-julkaisu.triplancloud.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "muurame",
            "Muurame",
            "https://muurame.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "myrskyla",
            "Myrskylä",
            "https://myrskyla-julkaisu.triplancloud.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "nokia",
            "Nokia",
            "https://nokia.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "pello",
            "Pello",
            "https://pello-julkaisu.triplancloud.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "pirkkala",
            "Pirkkala",
            "https://pirkkala.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "pornainen",
            "Pornainen",
            "https://pornainen-julkaisu.triplancloud.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "posio",
            "Posio",
            "https://posio.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "pukkila",
            "Pukkila",
            "https://pukkila.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "pyharanta",
            "Pyhäranta",
            "https://pyharanta.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "rauma",
            "Rauma",
            "https://rauma-julkaisu.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "sauvo",
            "Sauvo",
            "https://sauvo-julkaisu.triplancloud.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "sievi",
            "Sievi",
            "https://sievi-julkaisu.triplancloud.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "sodankyla",
            "Sodankylä",
            "https://sodankyla.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "taivalkoski",
            "Taivalkoski",
            "https://taivalkoski.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "taivassalo",
            "Taivassalo",
            "https://taivassalo-julkaisu.triplancloud.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "valkeakoski",
            "Valkeakoski",
            "https://valkeakoski.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "varkaus",
            "Varkaus",
            "https://varkaus.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "vehmaa",
            "Vehmaa",
            "https://vehmaa.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "voyri",
            "Vöyri",
            "https://voyri.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
        tweb(
            "ylitornio",
            "Ylitornio",
            "https://ylitornio.tweb.fi/ktwebscr/pk_tek_tweb.htm",
        ),
    ]
}

// ---------------------------------------------------------------------------
// Generic PDF listing (Drupal, WordPress, etc.)
// ---------------------------------------------------------------------------

pub fn generic_pdf_sources() -> Vec<MinuteSource> {
    vec![
        generic_pdf(
            "kannonkoski",
            "Kannonkoski",
            "https://kannonkoski.fi/esityslistat-ja-poytakirjat",
        ),
        generic_pdf(
            "kivijarvi",
            "Kivijärvi",
            "https://www.kivijarvi.fi/hallinto/poytakirjat",
        ),
    ]
}

// ---------------------------------------------------------------------------
// WordPress (WP REST API)
// ---------------------------------------------------------------------------

pub fn wordpress_sources() -> Vec<MinuteSource> {
    vec![
        wordpress("juupajoki", "Juupajoki", "https://juupajoki.fi"),
        // Batch 2
        wordpress("hirvensalmi", "Hirvensalmi", "https://www.hirvensalmi.fi"),
        wordpress("joutsa", "Joutsa", "https://www.joutsa.fi"),
        wordpress("karstula", "Karstula", "https://www.karstula.fi"),
        wordpress("kauhava", "Kauhava", "https://www.kauhava.fi"),
        wordpress("keitele", "Keitele", "https://www.keitele.fi"),
        wordpress("kiuruvesi", "Kiuruvesi", "https://www.kiuruvesi.fi"),
        wordpress("kokemaki", "Kokemäki", "https://www.kokemaki.fi"),
        wordpress("kotka", "Kotka", "https://www.kotka.fi"),
        wordpress("kustavi", "Kustavi", "https://www.kustavi.fi"),
        wordpress("lappajarvi", "Lappajärvi", "https://www.lappajarvi.fi"),
        wordpress("lemi", "Lemi", "https://www.lemi.fi"),
        // Batch 3
        wordpress("lestijarvi", "Lestijärvi", "https://lestijarvi.fi"),
        wordpress(
            "manttavilppula",
            "Mänttä-Vilppula",
            "https://manttavilppula.fi",
        ),
        wordpress("marttila", "Marttila", "https://marttila.fi"),
        wordpress("mustasaari", "Mustasaari", "https://mustasaari.fi"),
        wordpress("oripaa", "Oripää", "https://oripaa.fi"),
        wordpress("paimio", "Paimio", "https://paimio.fi"),
        wordpress("parikkala", "Parikkala", "https://parikkala.fi"),
        wordpress("pieksamaki", "Pieksämäki", "https://pieksamaki.fi"),
        wordpress("pielavesi", "Pielavesi", "https://pielavesi.fi"),
        wordpress("pietarsaari", "Pietarsaari", "https://pietarsaari.fi"),
        wordpress("pihtipudas", "Pihtipudas", "https://pihtipudas.fi"),
        wordpress("pomarkku", "Pomarkku", "https://pomarkku.fi"),
        wordpress("porvoo", "Porvoo", "https://porvoo.fi"),
        wordpress("riihimaki", "Riihimäki", "https://riihimaki.fi"),
        wordpress("saarijarvi", "Saarijärvi", "https://saarijarvi.fi"),
        wordpress("salla", "Salla", "https://salla.fi"),
        wordpress("siikainen", "Siikainen", "https://siikainen.fi"),
        wordpress("sipoo", "Sipoo", "https://sipoo.fi"),
        wordpress("siuntio", "Siuntio", "https://siuntio.fi"),
        wordpress("soini", "Soini", "https://soini.fi"),
        wordpress("sulkava", "Sulkava", "https://sulkava.fi"),
        wordpress("tervola", "Tervola", "https://tervola.fi"),
        wordpress("teuva", "Teuva", "https://teuva.fi"),
        wordpress("toivakka", "Toivakka", "https://toivakka.fi"),
        wordpress("vaasa", "Vaasa", "https://vaasa.fi"),
        wordpress("vierema", "Vieremä", "https://vierema.fi"),
        wordpress("virolahti", "Virolahti", "https://virolahti.fi"),
        wordpress("ypaja", "Ypäjä", "https://ypaja.fi"),
        wordpress("narpio", "Närpiö", "https://www.narpes.fi"),
        wordpress("koskitl", "Koski Tl", "https://koski.fi"),
    ]
}
