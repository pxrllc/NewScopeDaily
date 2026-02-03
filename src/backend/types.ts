export interface Article {
    id: string;          // Normalized Hash
    title: string;
    url: string;         // Normalised URL (was link)
    source: string;      // Feed Title
    published_at: string;// ISO8601 (was pubDate)
    description: string; // Plain text snippet

    // Optional/Internal fields
    sourceUrl?: string;
    region?: string;

    // Enriched fields
    summary?: string;    // AI Summary (replacing descriptionJa)
    country?: string;    // ISO Code
    category?: string;
    importanceScore?: number;
    titleJa?: string;    // Translated Title
}

export interface DayData {
    date: string;
    articles: Article[];
}

export interface GeoStats {
    [countryCode: string]: {
        count: number;
        topArticle?: Article;
        hasCritical?: boolean; // True if any article is Conflict/Disaster
    };
}
