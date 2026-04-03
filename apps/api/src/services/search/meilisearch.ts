/**
 * Meilisearch Search Service
 *
 * Provides fast, typo-tolerant search across users, threads, places, and tags.
 * Scales to millions of documents with <50ms response times.
 */

import { MeiliSearch } from "meilisearch";

// Initialize client
const client = new MeiliSearch({
  host: process.env.MEILI_URL || "http://localhost:7700",
  apiKey: process.env.MEILI_MASTER_KEY,
});

// Index names
export const INDEXES = {
  USERS: "users",
  THREADS: "threads",
  PLACES: "places",
  MUNICIPALITIES: "municipalities",
  LOCATIONS: "locations",
  TAGS: "tags",
  CLUBS: "clubs",
} as const;

// Document types for each index
export interface UserDocument {
  id: string;
  name: string;
  username: string;
  role: "citizen" | "institution" | "admin";
  avatarUrl?: string;
  institutionType?: string;
  institutionName?: string;
  municipalityName?: string;
  isAutomated?: boolean;
  createdAt: string;
}

export interface ThreadDocument {
  id: string;
  title: string;
  content: string;
  scope: "local" | "national" | "european";
  authorName: string;
  authorId: string;
  municipalityName?: string;
  municipalityId?: string;
  tags: string[];
  score: number;
  replyCount: number;
  isHidden: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlaceDocument {
  id: string;
  name: string;
  description?: string;
  category?: string;
  municipalityName?: string;
  municipalityId?: string;
  latitude?: number;
  longitude?: number;
}

export interface MunicipalityDocument {
  id: string;
  name: string;
  nameFi: string;
  region?: string;
  country: string;
}

export interface LocationDocument {
  id: string;
  osmId: number;
  osmType: string;
  name: string;
  nameFi?: string;
  nameSv?: string;
  nameEn?: string;
  displayName: string;
  type: string;
  adminLevel?: number;
  country: string;
  latitude: number;
  longitude: number;
  population?: number;
  contentCount: number;
  parentName?: string;
}

export interface ClubDocument {
  id: string;
  name: string;
  slug: string;
  description?: string;
  category?: string;
  memberCount: number;
  isPublic: boolean;
  createdAt: string;
}

export interface TagDocument {
  tag: string;
  count: number;
}

// Search result types
export interface SearchResults {
  users: UserDocument[];
  threads: ThreadDocument[];
  places: PlaceDocument[];
  municipalities: MunicipalityDocument[];
  locations: LocationDocument[];
  tags: TagDocument[];
  clubs: ClubDocument[];
  query: string;
  processingTimeMs: number;
}

/**
 * Initialize indexes with proper settings
 */
export async function initializeIndexes(): Promise<void> {
  console.log("Initializing Meilisearch indexes...");

  // Users index
  const usersIndex = client.index(INDEXES.USERS);
  await usersIndex.updateSettings({
    searchableAttributes: [
      "name",
      "username",
      "institutionName",
      "municipalityName",
    ],
    filterableAttributes: ["role", "institutionType"],
    sortableAttributes: ["createdAt", "name"],
    rankingRules: [
      "words",
      "typo",
      "proximity",
      "attribute",
      "sort",
      "exactness",
    ],
  });

  // Threads index
  const threadsIndex = client.index(INDEXES.THREADS);
  await threadsIndex.updateSettings({
    searchableAttributes: [
      "title",
      "content",
      "tags",
      "authorName",
      "municipalityName",
    ],
    filterableAttributes: [
      "scope",
      "municipalityId",
      "authorId",
      "tags",
      "isHidden",
    ],
    sortableAttributes: ["createdAt", "updatedAt", "score", "replyCount"],
    rankingRules: [
      "words",
      "typo",
      "proximity",
      "attribute",
      "sort",
      "exactness",
    ],
  });

  // Places index
  const placesIndex = client.index(INDEXES.PLACES);
  await placesIndex.updateSettings({
    searchableAttributes: [
      "name",
      "description",
      "category",
      "municipalityName",
    ],
    filterableAttributes: ["category", "municipalityId"],
    sortableAttributes: ["name"],
    rankingRules: [
      "words",
      "typo",
      "proximity",
      "attribute",
      "sort",
      "exactness",
    ],
  });

  // Municipalities index
  const municipalitiesIndex = client.index(INDEXES.MUNICIPALITIES);
  await municipalitiesIndex.updateSettings({
    searchableAttributes: ["name", "nameFi", "region"],
    filterableAttributes: ["country", "region"],
    sortableAttributes: ["name"],
    rankingRules: [
      "words",
      "typo",
      "proximity",
      "attribute",
      "sort",
      "exactness",
    ],
  });

  // Locations index (dynamic locations from Nominatim)
  const locationsIndex = client.index(INDEXES.LOCATIONS);
  await locationsIndex.updateSettings({
    searchableAttributes: [
      "name",
      "nameFi",
      "nameSv",
      "nameEn",
      "displayName",
      "parentName",
    ],
    filterableAttributes: ["country", "type", "adminLevel"],
    sortableAttributes: ["name", "contentCount", "population"],
    rankingRules: [
      "words",
      "typo",
      "proximity",
      "attribute",
      "sort",
      "exactness",
    ],
  });

  // Tags index
  const tagsIndex = client.index(INDEXES.TAGS);
  await tagsIndex.updateSettings({
    searchableAttributes: ["tag"],
    sortableAttributes: ["count"],
    rankingRules: [
      "words",
      "typo",
      "proximity",
      "attribute",
      "sort",
      "exactness",
    ],
  });

  // Clubs index
  const clubsIndex = client.index(INDEXES.CLUBS);
  await clubsIndex.updateSettings({
    searchableAttributes: ["name", "description", "category"],
    filterableAttributes: ["isPublic", "category"],
    sortableAttributes: ["memberCount", "createdAt", "name"],
    rankingRules: [
      "words",
      "typo",
      "proximity",
      "attribute",
      "sort",
      "exactness",
    ],
  });

  console.log("Meilisearch indexes initialized");
}

/**
 * Index a single user
 */
export async function indexUser(user: UserDocument): Promise<void> {
  await client.index(INDEXES.USERS).addDocuments([user]);
}

/**
 * Index multiple users
 */
export async function indexUsers(users: UserDocument[]): Promise<void> {
  if (users.length === 0) return;
  await client.index(INDEXES.USERS).addDocuments(users);
}

/**
 * Index a single thread
 */
export async function indexThread(thread: ThreadDocument): Promise<void> {
  await client
    .index(INDEXES.THREADS)
    .addDocuments([thread], { primaryKey: "id" });
}

/**
 * Index multiple threads
 */
export async function indexThreads(threads: ThreadDocument[]): Promise<void> {
  if (threads.length === 0) return;
  await client
    .index(INDEXES.THREADS)
    .addDocuments(threads, { primaryKey: "id" });
}

/**
 * Index a single place
 */
export async function indexPlace(place: PlaceDocument): Promise<void> {
  await client
    .index(INDEXES.PLACES)
    .addDocuments([place], { primaryKey: "id" });
}

/**
 * Index multiple places
 */
export async function indexPlaces(places: PlaceDocument[]): Promise<void> {
  if (places.length === 0) return;
  await client.index(INDEXES.PLACES).addDocuments(places, { primaryKey: "id" });
}

/**
 * Index municipalities
 */
export async function indexMunicipalities(
  municipalities: MunicipalityDocument[],
): Promise<void> {
  if (municipalities.length === 0) return;
  await client.index(INDEXES.MUNICIPALITIES).addDocuments(municipalities);
}

/**
 * Index a single location
 */
export async function indexLocation(location: LocationDocument): Promise<void> {
  await client
    .index(INDEXES.LOCATIONS)
    .addDocuments([location], { primaryKey: "id" });
}

/**
 * Index multiple locations
 */
export async function indexLocations(
  locations: LocationDocument[],
): Promise<void> {
  if (locations.length === 0) return;
  await client
    .index(INDEXES.LOCATIONS)
    .addDocuments(locations, { primaryKey: "id" });
}

/**
 * Index tags
 */
export async function indexTags(tags: TagDocument[]): Promise<void> {
  if (tags.length === 0) return;
  // Use sanitized tag as id (replace non-alphanumeric with underscore)
  const docsWithId = tags.map((t) => ({
    id: t.tag.replace(/[^a-zA-Z0-9-_]/g, "_"),
    ...t,
  }));
  await client
    .index(INDEXES.TAGS)
    .addDocuments(docsWithId, { primaryKey: "id" });
}

/**
 * Index a single club
 */
export async function indexClub(club: ClubDocument): Promise<void> {
  await client.index(INDEXES.CLUBS).addDocuments([club], { primaryKey: "id" });
}

/**
 * Index multiple clubs
 */
export async function indexClubs(clubs: ClubDocument[]): Promise<void> {
  if (clubs.length === 0) return;
  await client.index(INDEXES.CLUBS).addDocuments(clubs, { primaryKey: "id" });
}

/**
 * Delete a document from an index
 */
export async function deleteDocument(
  indexName: string,
  documentId: string,
): Promise<void> {
  await client.index(indexName).deleteDocument(documentId);
}

/**
 * Federated search across all indexes
 */
export async function search(
  query: string,
  options?: {
    limit?: number;
    userId?: string; // For personalization
  },
): Promise<SearchResults> {
  const limit = options?.limit || 5;
  const startTime = Date.now();

  const results = await client.multiSearch({
    queries: [
      {
        indexUid: INDEXES.USERS,
        q: query,
        limit,
        attributesToRetrieve: [
          "id",
          "name",
          "username",
          "role",
          "avatarUrl",
          "institutionType",
          "institutionName",
          "municipalityName",
        ],
      },
      {
        indexUid: INDEXES.THREADS,
        q: query,
        limit: limit * 2, // More threads
        filter: "isHidden = false",
        attributesToRetrieve: [
          "id",
          "title",
          "content",
          "scope",
          "authorName",
          "municipalityName",
          "tags",
          "score",
          "replyCount",
          "createdAt",
        ],
      },
      {
        indexUid: INDEXES.PLACES,
        q: query,
        limit,
        attributesToRetrieve: [
          "id",
          "name",
          "description",
          "category",
          "municipalityName",
        ],
      },
      {
        indexUid: INDEXES.MUNICIPALITIES,
        q: query,
        limit,
        attributesToRetrieve: ["id", "name", "nameFi", "region", "country"],
      },
      {
        indexUid: INDEXES.LOCATIONS,
        q: query,
        limit,
        attributesToRetrieve: [
          "id",
          "osmId",
          "osmType",
          "name",
          "nameFi",
          "displayName",
          "type",
          "country",
          "contentCount",
          "parentName",
        ],
      },
      {
        indexUid: INDEXES.TAGS,
        q: query,
        limit,
        attributesToRetrieve: ["tag", "count"],
      },
      {
        indexUid: INDEXES.CLUBS,
        q: query,
        limit,
        filter: "isPublic = true",
        attributesToRetrieve: [
          "id",
          "name",
          "slug",
          "description",
          "category",
          "memberCount",
        ],
      },
    ],
  });

  const processingTimeMs = Date.now() - startTime;

  return {
    users: (results.results[0]?.hits as UserDocument[]) || [],
    threads: (results.results[1]?.hits as ThreadDocument[]) || [],
    places: (results.results[2]?.hits as PlaceDocument[]) || [],
    municipalities: (results.results[3]?.hits as MunicipalityDocument[]) || [],
    locations: (results.results[4]?.hits as LocationDocument[]) || [],
    tags: (results.results[5]?.hits as TagDocument[]) || [],
    clubs: (results.results[6]?.hits as ClubDocument[]) || [],
    query,
    processingTimeMs,
  };
}

/**
 * Search only users
 */
export async function searchUsers(
  query: string,
  limit = 10,
): Promise<UserDocument[]> {
  const results = await client.index(INDEXES.USERS).search(query, { limit });
  return results.hits as UserDocument[];
}

/**
 * Search only threads
 */
export async function searchThreads(
  query: string,
  options?: {
    limit?: number;
    scope?: "local" | "national" | "european";
    municipalityId?: string;
    tags?: string[];
  },
): Promise<ThreadDocument[]> {
  const filter: string[] = ["isHidden = false"];
  if (options?.scope) filter.push(`scope = "${options.scope}"`);
  if (options?.municipalityId)
    filter.push(`municipalityId = "${options.municipalityId}"`);
  if (options?.tags?.length) {
    const tagFilters = options.tags.map((t) => `tags = "${t}"`).join(" OR ");
    filter.push(`(${tagFilters})`);
  }

  const results = await client.index(INDEXES.THREADS).search(query, {
    limit: options?.limit || 20,
    filter: filter.length > 0 ? filter.join(" AND ") : undefined,
    sort: ["score:desc", "updatedAt:desc"],
  });
  return results.hits as ThreadDocument[];
}

/**
 * Search only places
 */
export async function searchPlaces(
  query: string,
  limit = 10,
): Promise<PlaceDocument[]> {
  const results = await client.index(INDEXES.PLACES).search(query, { limit });
  return results.hits as PlaceDocument[];
}

/**
 * Get Meilisearch client for direct access
 */
export function getClient(): MeiliSearch {
  return client;
}

/**
 * Health check
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const health = await client.health();
    return health.status === "available";
  } catch {
    return false;
  }
}
