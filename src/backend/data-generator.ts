import * as fs from 'fs';
import * as path from 'path';
import { Article, DayData, GeoStats } from './types';
import { marked } from 'marked';
import { Feed } from 'feed';

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

    // Generate RSS, Atom, and JSON Feeds in public/ directory
    public generateFeeds(articles: Article[]) {
        const publicDir = path.join(this.outputDir, '..');
        
        // Sort articles by publication date descending (newest first)
        const sortedArticles = [...articles].sort((a, b) => {
            return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
        });

        const feed = new Feed({
            title: "NewsScope Daily",
            description: "世界各地のニュースソースから情報を自動収集し、AIで要約・分類した日本語ニュースフィード",
            id: "https://pxrllc.github.io/NewScopeDaily/",
            link: "https://pxrllc.github.io/NewScopeDaily/",
            language: "ja",
            image: "https://pxrllc.github.io/NewScopeDaily/favicon.png",
            favicon: "https://pxrllc.github.io/NewScopeDaily/favicon.png",
            copyright: `All rights reserved ${new Date().getFullYear()}, NewsScope Daily`,
            updated: new Date(),
            generator: "NewsScope Daily Feed Generator",
            feedLinks: {
                rss: "https://pxrllc.github.io/NewScopeDaily/feed.xml",
                atom: "https://pxrllc.github.io/NewScopeDaily/atom.xml",
                json: "https://pxrllc.github.io/NewScopeDaily/feed.json"
            },
            author: {
                name: "NewsScope Daily",
                link: "https://pxrllc.github.io/NewScopeDaily/"
            }
        });

        sortedArticles.forEach(article => {
            const title = article.titleJa || article.title;
            const description = article.summary || article.description;
            const categoryName = article.categoryJa || article.category || "未分類";
            
            // Generate detailed HTML content for feed readers
            const content = `
                <p>${description}</p>
                <hr/>
                <p>
                    <strong>配信元:</strong> ${article.source}<br/>
                    <strong>対象国:</strong> ${article.country || '不明'}<br/>
                    <strong>カテゴリ:</strong> ${categoryName}<br/>
                    <strong>重要度スコア:</strong> ${article.importanceScore || 'N/A'}
                </p>
            `;

            feed.addItem({
                title: title,
                id: article.id,
                link: article.url,
                description: description,
                content: content,
                date: new Date(article.published_at),
                image: article.imageUrl
            });
        });

        // Write files
        fs.writeFileSync(path.join(publicDir, 'feed.xml'), feed.rss2());
        fs.writeFileSync(path.join(publicDir, 'atom.xml'), feed.atom1());
        fs.writeFileSync(path.join(publicDir, 'feed.json'), feed.json1());
        
        console.log("Feeds generated (feed.xml, atom.xml, feed.json).");
    }
}
