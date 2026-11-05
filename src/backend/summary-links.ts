import { Article } from './types';

/**
 * Gemini often fails to emit proper markdown links in the daily summaries:
 *   "Title (CC)"                -> URL omitted entirely
 *   "Title (CC) (https://...)"  -> URL present but not a markdown link
 * It does reliably copy the article title, so we match quoted titles back to
 * the input articles and rewrite them as "[Title](url)". Already-correct
 * links are left untouched.
 */
export function linkifySummary(md: string, articles: Article[]): string {
    const byTitle = new Map<string, string>();
    for (const a of articles) {
        if (a.title && a.url) byTitle.set(normalize(a.title), a.url);
    }

    // A quoted title, optionally followed by a URL the model put outside the quotes:
    //   "Title"(https://...)   "Title" (https://...)   "Title" Link: https://...
    const re = /"([^"\n]+)"(?:\s*\((https?:\/\/[^\s)]+)\)|\s+Link:\s*(https?:\/\/[^\s)]+))?/g;

    return md.replace(re, (whole, inner: string, outerUrl1?: string, outerUrl2?: string) => {
        if (/\]\(https?:\/\//.test(inner)) return whole; // already "[Title](url)"

        let text = inner.trim();
        let modelUrl = outerUrl1 ?? outerUrl2;

        // URL inside the quotes: "Title (CC) (https://...)"
        const m = text.match(/^(.*?)\s*\((https?:\/\/[^\s)]+)\)$/);
        if (m) { text = m[1].trim(); modelUrl = modelUrl ?? m[2]; }

        // Strip trailing country code the prompt appends: "Title (US)"
        const title = text.replace(/\s*\(([A-Z]{2})\)$/, '').trim();
        // Prefer the URL from our own data; fall back to what the model wrote.
        const url = byTitle.get(normalize(title)) ?? modelUrl;
        if (!url) return whole;

        return `"[${escapeLinkText(title)}](${url})"`;
    });
}

function normalize(s: string): string {
    return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
}

function escapeLinkText(s: string): string {
    return s.replace(/([\[\]])/g, '\\$1');
}
