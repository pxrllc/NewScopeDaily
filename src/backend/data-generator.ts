import * as fs from 'fs';
import * as path from 'path';
import { Article, DayData, GeoStats } from './types';
import { marked } from 'marked';

export class DataGenerator {
    private outputDir: string;

    constructor(outputDir: string) {
        this.outputDir = outputDir;
    }

    // Generate feed.json
    public generateFeedJson(date: string, articles: Article[]) {
        const dailyDir = path.join(this.outputDir, 'daily', date);
        if (!fs.existsSync(dailyDir)) {
            fs.mkdirSync(dailyDir, { recursive: true });
        }

        const feedData: DayData = {
            date,
            articles
        };

        fs.writeFileSync(path.join(dailyDir, 'feed.json'), JSON.stringify(feedData, null, 2));
        // Also update latest feed at root/data/latest.json (optional, or just use daily/latest)
    }

    // Generate map.json
    public generateMapJson(date: string, articles: Article[]) {
        const stats: GeoStats = {};

        articles.forEach(article => {
            const country = article.country || 'XX';
            if (country === 'XX') return;

            if (!stats[country]) {
                stats[country] = { count: 0 };
            }
            stats[country].count++;

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

        // Optional: Save as HTML fragment for easier frontend inclusion
        // const htmlWorld = marked.parse(summaryWorld);
        // fs.writeFileSync(path.join(dailyDir, 'summary_world.html'), htmlWorld);
    }
}
