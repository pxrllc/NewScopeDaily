import * as fs from 'fs';
import * as path from 'path';
import { Article, DayData, GeoStats } from './types';
import { marked } from 'marked';

export class DataGenerator {
    private outputDir: string;

    constructor(outputDir: string) {
        this.outputDir = outputDir;
    }

    // Generate feed.json (Reverted to daily/{date}/feed.json)
    public generateFeedJson(date: string, articles: Article[]) {
        const dailyDir = path.join(this.outputDir, 'daily', date);
        if (!fs.existsSync(dailyDir)) {
            fs.mkdirSync(dailyDir, { recursive: true });
        }

        // Wrapper envelope with metadata (Keeping new Schema)
        const dataEnvelope = {
            generated_at: new Date().toISOString(),
            version: "1.0",
            articles: articles
        };

        const filePath = path.join(dailyDir, 'feed.json');
        fs.writeFileSync(filePath, JSON.stringify(dataEnvelope, null, 2));

        // Update latest.json (Optional, keeping as root/latest.json is useful)
        const latestPath = path.join(this.outputDir, 'latest.json');
        fs.writeFileSync(latestPath, JSON.stringify(dataEnvelope, null, 2));
    }

    // Generate map.json
    public generateMapJson(date: string, articles: Article[]) {
        const stats: GeoStats = {};

        articles.forEach(article => {
            const country = article.country || 'XX';
            if (country === 'XX') return;

            if (!stats[country]) {
                stats[country] = { count: 0, hasCritical: false };
            }
            stats[country].count++;

            // Flag critical news
            if (article.category === 'Conflict' || article.category === 'Disaster') {
                stats[country].hasCritical = true;
            }

            // Keep the highest importance article as "topArticle" for the map tooltip
            if (!stats[country].topArticle || (article.importanceScore || 0) > (stats[country].topArticle?.importanceScore || 0)) {
                stats[country].topArticle = article;
            }
        });

        const dailyDir = path.join(this.outputDir, 'daily', date);
        // Ensure dir exists (redundant if called after feed.json but safe)
        if (!fs.existsSync(dailyDir)) fs.mkdirSync(dailyDir, { recursive: true });

        fs.writeFileSync(path.join(dailyDir, 'map.json'), JSON.stringify(stats, null, 2));
    }

    // Save generated markdown summaries (and convert to HTML fragment if needed)
    public saveSummaries(date: string, summaryWorld: string, summaryRegional: string) {
        const dailyDir = path.join(this.outputDir, 'daily', date);
        if (!fs.existsSync(dailyDir)) fs.mkdirSync(dailyDir, { recursive: true });

        fs.writeFileSync(path.join(dailyDir, 'summary_world.md'), summaryWorld);
        fs.writeFileSync(path.join(dailyDir, 'summary_regional.md'), summaryRegional);
    }

    public generateSourcesJson(articles: Article[]) {
        const sources = Array.from(new Set(articles.map(a => a.source))).sort();
        const sourcesPath = path.join(this.outputDir, 'sources.json');

        const data = {
            generated_at: new Date().toISOString(),
            count: sources.length,
            sources: sources
        };

        fs.writeFileSync(sourcesPath, JSON.stringify(data, null, 2));
    }
}
