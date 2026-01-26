
import Parser from 'rss-parser';

const parser = new Parser({
    customFields: {
        item: [
            ['geo:lat', 'lat'],
            ['geo:long', 'long'],
            ['dc:coverage', 'coverage'],
            ['category', 'categories', { keepArray: true }],
        ]
    }
});

async function inspect() {
    // BBC World News (example)
    const url = 'http://feeds.bbci.co.uk/news/world/rss.xml';
    console.log(`Fetching ${url}...`);
    try {
        const feed = await parser.parseURL(url);
        console.log("Feed Title:", feed.title);
        if (feed.items.length > 0) {
            const item = feed.items[0];
            console.log("--- First Item Raw Keys ---");
            console.log(Object.keys(item));
            console.log("--- Item Details ---");
            console.log("Title:", item.title);
            console.log("Categories:", item.categories); // Often contains country/topic
            console.log("Geo:", item.lat, item.long);
            console.log("Link:", item.link);
            console.log("Full Object:", JSON.stringify(item, null, 2));
        }
    } catch (e) {
        console.error(e);
    }
}

inspect();
