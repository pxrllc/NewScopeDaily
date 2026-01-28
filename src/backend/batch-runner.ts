import { RssFetcher } from './rss-fetcher';
import { GeminiClient } from './gemini-client';
import { DataGenerator } from './data-generator';
import * as path from 'path';
import * as fs from 'fs';

// Configuration
const OPML_PATH = path.join(__dirname, '../../doc/global-perspectives.opml');
const OUTPUT_DIR = path.join(__dirname, '../../public/data');

// Logging Helper
function appendLog(message: string) {
    const logDir = path.join(__dirname, '../../logs');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, 'execution.log');
    fs.appendFileSync(logFile, message + '\n');
}

async function main() {
    const startTime = new Date();
    // Use JST for logging display (approximate by adding 9 hours if local is UTC, or just use ISO)
    // For simplicity, using simple local string or ISO.
    // User requested format: 2026-02-01 04:00:00 START
    const timestamp = startTime.toISOString().replace('T', ' ').substring(0, 19);

    appendLog(`${timestamp} START`);

    // Calculate Date in JST (UTC+9)
    // If running at 4AM JST (19:00 UTC previous day), we want the JST date.
    // 19:00 UTC + 9h = 04:00 JST (Next Day).
    const jstDate = new Date(startTime.getTime() + 9 * 60 * 60 * 1000);
    const date = jstDate.toISOString().split('T')[0]; // YYYY-MM-DD (JST)
    console.log(`Starting Batch for ${date} (JST)...`);

    try {
        // 1. Fetch
        const fetcher = new RssFetcher(OPML_PATH);
        const articles = await fetcher.fetchAll();
        console.log(`Fetched ${articles.length} articles.`);

        // Log RSS Stats (Approximate count based on success)
        // Check types.ts if fetcher returns detailed stats?
        // For now logging total fetched.
        appendLog(`- RSS取得: Success (${articles.length > 0 ? 'OK' : 'No Data'})`);
        appendLog(`- 全件: ${articles.length} items`);

        // 2. Filter & Process (Gemini)
        const gemini = new GeminiClient();
        const processedArticles = [];

        // Optimization: Filter Top N articles per source to limit API usage
        // Target: ~150 articles total (15 sources * 10).
        // Since we dropped raw articles, we process more to keep the feed full.
        const ITEMS_PER_SOURCE = 10;
        const articlesToProcess: any[] = [];
        const sourceCounts: { [key: string]: number } = {};

        for (const article of articles) {
            const source = article.source || 'Unknown';
            if (!sourceCounts[source]) sourceCounts[source] = 0;

            if (sourceCounts[source] < ITEMS_PER_SOURCE) {
                articlesToProcess.push(article);
                sourceCounts[source]++;
            }
        }

        console.log(`Filtered down to ${articlesToProcess.length} articles for AI processing.`);
        appendLog(`- Filtered: ${articlesToProcess.length} items`);

        // Batch Process
        const BATCH_SIZE = 10;
        // const SAFETY_PAUSE_THRESHOLD = 2; // Removed for Tier 1

        for (let i = 0; i < articlesToProcess.length; i += BATCH_SIZE) {
            const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(articlesToProcess.length / BATCH_SIZE);

            console.log(`Processing batch ${batchIndex}/${totalBatches}...`);

            try {
                const batch = articlesToProcess.slice(i, i + BATCH_SIZE);
                const enrichedBatch = await gemini.enrichBatch(batch);
                processedArticles.push(...enrichedBatch);
            } catch (err) {
                console.error(`Batch ${batchIndex} failed, continuing with raw data.`, err);
                const batch = articlesToProcess.slice(i, i + BATCH_SIZE);
                processedArticles.push(...batch);
            }
        }

        appendLog(`- Translated/Processed: ${processedArticles.length} items`);

        // 3. Summarize
        let worldSummary = "# World Summary (Generation Failed)";
        let regionalSummary = "# Regional Summary (Generation Failed)";

        try {
            console.log("Generating World Summary...");
            worldSummary = await gemini.generateDailySummary(processedArticles, 'world');

            // Determine Regional Focus
            const day = new Date().getDay();
            const regions = ['Middle East', 'Asia', 'Africa', 'Middle East', 'Latin America', 'Europe', 'Africa'];
            const focusRegion = regions[day];

            console.log(`Generating Regional Summary (${focusRegion})...`);
            regionalSummary = await gemini.generateDailySummary(processedArticles, 'regional', focusRegion);
        } catch (e) {
            console.error("Summary generation failed due to API limits or error. proceeding with data save.", e);
        }

        // 4. Generate Data
        const generator = new DataGenerator(OUTPUT_DIR);

        // Merge & Save Logic...
        // Merge & Save Logic...
        // OLD: Merged raw items back in.
        // NEW: Only save processed items to ensure high quality (Translated + Country).
        const finalArticles: any[] = [...processedArticles];

        // Log dropped count
        const droppedCount = articles.length - finalArticles.length;
        if (droppedCount > 0) {
            console.log(`Dropped ${droppedCount} raw articles to ensure quality.`);
        }

        generator.generateFeedJson(date, finalArticles);
        generator.generateMapJson(date, processedArticles);
        generator.saveSummaries(date, worldSummary, regionalSummary);


        // 5. Generate Date Manifest for Frontend Navigation
        const dailyDataDir = path.join(OUTPUT_DIR, 'daily');
        if (fs.existsSync(dailyDataDir)) {
            const availableDates = fs.readdirSync(dailyDataDir)
                .filter(entry => {
                    const fullPath = path.join(dailyDataDir, entry);
                    return /^\d{4}-\d{2}-\d{2}$/.test(entry) && fs.statSync(fullPath).isDirectory();
                })
                .sort(); // ISO format sorts correctly lexicographically

            const manifestPath = path.join(dailyDataDir, 'available-dates.json');
            fs.writeFileSync(manifestPath, JSON.stringify(availableDates, null, 2));
            appendLog(`- Manifest Updated: ${availableDates.length} dates available`);
        }

        console.log("Batch Complete (Files Saved).");
        appendLog(`- JSON生成: OK`);
        appendLog(`- Deploy: OK (Scheduled via Actions)`);

    } catch (error: any) {
        console.error("Batch Failed:", error);
        appendLog(`- Error: ${error.message}`);
        process.exit(1);
    } finally {
        const endTime = new Date();
        const endTimestamp = endTime.toISOString().replace('T', ' ').substring(0, 19);
        appendLog(`${endTimestamp} END`);
        appendLog(''); // Empty line
    }
}

main().catch(err => console.error(err));
