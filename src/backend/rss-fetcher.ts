import Parser from 'rss-parser';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Article } from './types';

const parser = new Parser();

export class RssFetcher {
    private opmlPath: string;

    constructor(opmlPath: string) {
        this.opmlPath = opmlPath;
    }

    private parseOpml(): { url: string; title: string, region: string }[] {
        const fileContent = fs.readFileSync(this.opmlPath, 'utf-8');
        const feeds: { url: string; title: string, region: string }[] = [];

        // Global Regex find all outline tags
        const outlineRegex = /<outline\s+([^>]+)>/g;
        let match;
        // Simple heuristic: Regions appear as outlines without xmlUrl
        // Feeds appear as outlines WITH xmlUrl
        // Since feeds are children of regions, usually the Region header appears first.
        let currentRegion = "World";

        while ((match = outlineRegex.exec(fileContent)) !== null) {
            const attributes = match[1];

            const textMatch = attributes.match(/text="([^"]+)"/);
            const xmlUrlMatch = attributes.match(/xmlUrl="([^"]+)"/);

            if (xmlUrlMatch) {
                feeds.push({
                    title: textMatch ? textMatch[1] : 'Unknown Feed',
                    url: xmlUrlMatch[1],
                    region: currentRegion
                });
            } else if (textMatch) {
                // If it has text but no xmlUrl, treat as a Region header
                currentRegion = textMatch[1];
            }
        }
        return feeds;
    }

    private generateId(link: string): string {
        return crypto.createHash('md5').update(link).digest('hex');
    }

    public async fetchAll(): Promise<Article[]> {
        const feeds = this.parseOpml();
        console.log(`Found ${feeds.length} feeds in OPML.`);

        let allArticles: Article[] = [];

        for (const feedInfo of feeds) {
            try {
                console.log(`Fetching ${feedInfo.title}...`);
                const feed = await parser.parseURL(feedInfo.url);

                const items = feed.items.slice(0, 20).map(item => {
                    return {
                        id: this.generateId(item.link || item.title || ''),
                        title: item.title || '',
                        link: item.link || '',
                        pubDate: item.isoDate || item.pubDate || new Date().toISOString(),
                        snippet: item.contentSnippet || item.content || '',
                        source: feedInfo.title,
                        sourceUrl: feedInfo.url,
                        region: feedInfo.region
                    } as Article;
                });

                allArticles.push(...items);
            } catch (error: any) {
                console.error(`Failed to fetch ${feedInfo.url}: ${error.message}`);
            }
        }

        const seenIds = new Set();
        const seenTitles = new Set();

        allArticles = allArticles.filter(item => {
            // Dedupe by ID (Link Hash)
            if (seenIds.has(item.id)) return false;
            seenIds.add(item.id);

            // Dedupe by Normalized Title (simple wire story check)
            const normalizedTitle = item.title.trim().toLowerCase();
            if (seenTitles.has(normalizedTitle)) return false;
            seenTitles.add(normalizedTitle);

            return true;
        });

        return allArticles;
    }
}
