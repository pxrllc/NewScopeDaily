
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');

const parser = new Parser();
const opmlPath = path.join(__dirname, 'doc/global-perspectives.opml');
const outputPath = path.join(__dirname, 'test_rss_data.json');

async function fetchAll() {
    const fileContent = fs.readFileSync(opmlPath, 'utf-8');
    const regex = /xmlUrl="([^"]+)"/g;
    const urls = [];
    let match;
    while ((match = regex.exec(fileContent)) !== null) {
        urls.push(match[1]);
    }

    console.log(`Fetching ${urls.length} feeds...`);

    const allItems = [];

    for (const url of urls) {
        try {
            const feed = await parser.parseURL(url);
            console.log(`[OK] ${feed.title} (${feed.items.length} items)`);

            // Add source info to each item and limit to top 15 recent items to avoid huge data
            const recentItems = feed.items.slice(0, 15).map(item => ({
                title: item.title,
                link: item.link,
                pubDate: item.pubDate,
                snippet: item.contentSnippet || item.content || "",
                source: feed.title,
                sourceUrl: url
            }));

            allItems.push(...recentItems);
        } catch (error) {
            console.error(`[FAIL] ${url}: ${error.message}`);
        }
    }

    fs.writeFileSync(outputPath, JSON.stringify(allItems, null, 2));
    console.log(`Saved ${allItems.length} items to ${outputPath}`);
}

fetchAll();
