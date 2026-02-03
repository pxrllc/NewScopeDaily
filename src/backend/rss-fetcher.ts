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

    private normalizeUrl(url: string): string {
        try {
            const parsed = new URL(url);

            // Remove tracking params
            const paramsToRemove = [
                /^utm_/, /^fbclid/, /^ref$/i, /^s$/i, /^_ga/, /^gclid/
            ];

            const params = new URLSearchParams(parsed.search);
            const keys = Array.from(params.keys());

            keys.forEach(key => {
                if (paramsToRemove.some(regex => regex.test(key))) {
                    params.delete(key);
                }
            });

            parsed.search = params.toString();
            parsed.hash = ''; // Remove fragment

            // Remove trailing slash
            let cleanUrl = parsed.toString();
            if (cleanUrl.endsWith('/')) {
                cleanUrl = cleanUrl.slice(0, -1);
            }

            return cleanUrl;
        } catch (e) {
            return url; // Return original if parse fails
        }
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
                    const rawLink = item.link || item.title || '';
                    const normalizedUrl = this.normalizeUrl(rawLink);

                    return {
                        id: this.generateId(normalizedUrl),
                        title: item.title || '',
                        url: normalizedUrl,
                        published_at: item.isoDate || item.pubDate || new Date().toISOString(),
                        description: item.contentSnippet || item.content || '',
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
