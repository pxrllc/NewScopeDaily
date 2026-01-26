
import { RssFetcher } from './rss-fetcher';
import * as path from 'path';

const OPML_PATH = path.join(__dirname, '../../doc/global-perspectives.opml');

async function main() {
    console.log("Testing RssFetcher...");
    const fetcher = new RssFetcher(OPML_PATH);
    const articles = await fetcher.fetchAll();
    console.log(`Fetched ${articles.length} articles.`);
    if (articles.length > 0) {
        console.log("Sample:", articles[0]);
    }
}

main().catch(err => console.error(err));
