export interface Article {
    id: string; // Hash of link or title
    title: string;
    link: string;
    pubDate: string;
    snippet: string;
    source: string;
    sourceUrl: string;
    region?: string; // e.g., "Africa", "Middle East", "World"

    // Enriched fields (by Gemini)
    country?: string; // ISO Code
    category?: string; // "Politics", "Conflict", "Environment", etc.
    importanceScore?: number; // 0-100
    titleJa?: string;
    summaryJa?: string;
}

export interface DayData {
    date: string;
    articles: Article[];
}

export interface GeoStats {
    [countryCode: string]: {
        count: number;
        topArticle?: Article;
    };
}
