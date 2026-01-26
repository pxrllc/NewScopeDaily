
const fs = require('fs');
const path = require('path');

const opmlPath = path.join(__dirname, 'doc/global-perspectives.opml');
const fileContent = fs.readFileSync(opmlPath, 'utf-8');

const regex = /xmlUrl="([^"]+)"/g;
const urls = [];
let match;

while ((match = regex.exec(fileContent)) !== null) {
    urls.push(match[1]);
}

console.log(`Found ${urls.length} RSS URLs. Verifying...`);

async function verifyUrl(url) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        clearTimeout(timeout);

        if (res.ok) {
            console.log(`[OK] ${url}`);
            return true;
        } else {
            console.error(`[FAIL] ${url} (Status: ${res.status})`);
            return false;
        }
    } catch (error) {
        console.error(`[ERROR] ${url} (${error.message})`);
        return false;
    }
}

async function run() {
    let successCount = 0;
    for (const url of urls) {
        const isSuccess = await verifyUrl(url);
        if (isSuccess) successCount++;
    }
    console.log(`\nVerification complete. ${successCount}/${urls.length} accessible.`);
}

run();
