import { RssFetcher } from './rss-fetcher';
import { GeminiClient } from './gemini-client';
import { DataGenerator } from './data-generator';
import * as path from 'path';
import * as fs from 'fs';

// Configuration
const OPML_PATH = path.join(__dirname, '../../doc/global-perspectives.opml');
const OUTPUT_DIR = path.join(__dirname, '../../public/data');

async function main() {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    console.log(`Starting Batch for ${date}...`);

    // 1. Fetch
    const fetcher = new RssFetcher(OPML_PATH);
    const articles = await fetcher.fetchAll();
    console.log(`Fetched ${articles.length} articles.`);

    // 2. Filter & Process (Gemini)
    const gemini = new GeminiClient();
    const processedArticles = [];

    // Optimization: Filter Top N articles per source to limit API usage
    // Target: 60 articles total. 15 sources -> ~4 per source.
    const ITEMS_PER_SOURCE = 4;
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

    // Batch Process
    const BATCH_SIZE = 10;
    const SAFETY_PAUSE_THRESHOLD = 2; // Pause after every 2 batches (20 items)

    for (let i = 0; i < articlesToProcess.length; i += BATCH_SIZE) {
        const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(articlesToProcess.length / BATCH_SIZE);

        console.log(`Processing batch ${batchIndex}/${totalBatches}...`);

        // Safety Pause removed for Tier 1
        // if (batchIndex > 1 && (batchIndex - 1) % SAFETY_PAUSE_THRESHOLD === 0) { ... }

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

    // 4. Generate Data (Always run, even if enrichment/summary had partial failures)
    // If processedArticles is empty (unlikely if fetch worked), we might want to fill it with raw articles?
    // For now, let's mix processed and unprocessed if needed, or just save what we have.
    // If processedArticles len < limit, we should probably append the rest of raw articles (without AI data) 
    // so the news list isn't empty.



    // Add remaining raw articles (without AI fields) to fill the list
    const processedIds = new Set(processedArticles.map(a => a.id));
    const finalArticles: any[] = [...processedArticles]; // Use any[] or Article[] to allow mix

    for (const a of articles) {
        if (!processedIds.has(a.id)) {
            finalArticles.push(a);
        }
    }

    // Sort by date newly? Fetcher output is usually rough.

    const generator = new DataGenerator(OUTPUT_DIR);
    generator.generateFeedJson(date, finalArticles);
    generator.generateMapJson(date, processedArticles); // Map only uses enriched ones usually
    generator.saveSummaries(date, worldSummary, regionalSummary);

    console.log("Batch Complete (Files Saved).");
}

main().catch(err => console.error(err));
