/**
 * A/B test: Gemini 2.5 Flash with thinking (API default) vs thinkingBudget=0.
 * Calls the Gemini API directly (same as production), runs each condition twice
 * to measure run-to-run noise, then has an independent judge model compare
 * ON vs OFF blind.
 *
 * Usage: npm run thinking-ab -- [--date YYYY-MM-DD] [--sample 30] [--judge ~anthropic/claude-sonnet-latest] [--reuse <prev result dir>]
 * Requires GEMINI_API_KEY and OPENROUTER_API_KEY (for the judge) in .env.
 */
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { Article } from '../backend/types';
import { buildEnrichPrompt, buildSummaryPrompt } from '../backend/prompts';
dotenv.config();

const ROOT = path.join(__dirname, '../..');
const DAILY_DIR = path.join(ROOT, 'public/data/daily');
const MODEL = 'gemini-2.5-flash';
const PRICE_IN = 0.30, PRICE_OUT = 2.50; // USD / 1M tokens (output incl. thinking)
const BATCH_SIZE = 10;

const args = process.argv.slice(2);
const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const dates = fs.readdirSync(DAILY_DIR).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const DATE = arg('date') ?? dates[dates.length - 1];
const SAMPLE = parseInt(arg('sample') ?? '30', 10);
const JUDGE = arg('judge') ?? '~anthropic/claude-sonnet-latest';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

interface Usage { inTok: number; outTok: number; thoughtTok: number; cost: number; ms: number }
const addUsage = (a: Usage, b: Usage): Usage => ({ inTok: a.inTok + b.inTok, outTok: a.outTok + b.outTok, thoughtTok: a.thoughtTok + b.thoughtTok, cost: a.cost + b.cost, ms: a.ms + b.ms });
const zero = (): Usage => ({ inTok: 0, outTok: 0, thoughtTok: 0, cost: 0, ms: 0 });

async function gemini(prompt: string, thinking: boolean): Promise<{ text: string; usage: Usage }> {
    for (let attempt = 1; ; attempt++) {
        const t = Date.now();
        try {
            const res = await ai.models.generateContent({
                model: MODEL,
                contents: prompt,
                ...(thinking ? {} : { config: { thinkingConfig: { thinkingBudget: 0 } } }),
            });
            const u: any = res.usageMetadata ?? {};
            const inTok = u.promptTokenCount ?? 0, outTok = u.candidatesTokenCount ?? 0, thoughtTok = u.thoughtsTokenCount ?? 0;
            return {
                text: res.text ?? '',
                usage: { inTok, outTok, thoughtTok, ms: Date.now() - t, cost: (inTok * PRICE_IN + (outTok + thoughtTok) * PRICE_OUT) / 1e6 },
            };
        } catch (e: any) {
            const s = e?.status;
            if ((s === 429 || s === 503 || s === 500) && attempt < 4) { await new Promise(r => setTimeout(r, 30_000)); continue; }
            throw e;
        }
    }
}

function parseArray(text: string): any[] {
    const s = text.indexOf('['), e = text.lastIndexOf(']');
    return JSON.parse(text.slice(s, e + 1));
}

function sampleArticles(all: Article[], n: number): Article[] {
    const by = new Map<string, Article[]>();
    for (const a of all) { if (!by.has(a.source)) by.set(a.source, []); by.get(a.source)!.push(a); }
    const qs = [...by.values()], out: Article[] = [];
    while (out.length < n && qs.some(q => q.length)) for (const q of qs) if (q.length && out.length < n) out.push(q.shift()!);
    return out;
}

interface Run { label: string; thinking: boolean; items: Record<string, any>; summary: string; enrichUsage: Usage; summaryUsage: Usage }

async function runCondition(label: string, thinking: boolean, sample: Article[], all: Article[]): Promise<Run> {
    const run: Run = { label, thinking, items: {}, summary: '', enrichUsage: zero(), summaryUsage: zero() };
    for (let i = 0; i < sample.length; i += BATCH_SIZE) {
        const r = await gemini(buildEnrichPrompt(sample.slice(i, i + BATCH_SIZE)), thinking);
        run.enrichUsage = addUsage(run.enrichUsage, r.usage);
        try { for (const d of parseArray(r.text)) run.items[d.id] = d; } catch { console.log(`  [${label}] batch parse failed`); }
        console.log(`  [${label}] batch ${i / BATCH_SIZE + 1}: out=${r.usage.outTok} thoughts=${r.usage.thoughtTok} ${(r.usage.ms / 1000).toFixed(1)}s`);
    }
    const s = await gemini(buildSummaryPrompt(all, 'world', DATE), thinking);
    run.summary = s.text; run.summaryUsage = s.usage;
    console.log(`  [${label}] summary: out=${s.usage.outTok} thoughts=${s.usage.thoughtTok} ${(s.usage.ms / 1000).toFixed(1)}s`);
    return run;
}

function agreement(a: Run, b: Run, sample: Article[]) {
    let n = 0, c = 0, k = 0, d = 0;
    for (const x of sample) {
        const p = a.items[x.id], q = b.items[x.id];
        if (!p || !q) continue;
        n++; if (p.country === q.country) c++; if (p.category === q.category) k++;
        d += Math.abs((p.importanceScore ?? 0) - (q.importanceScore ?? 0));
    }
    return { n, country: 100 * c / n, category: 100 * k / n, scoreMae: d / n };
}

function linkStats(md: string, urls: Set<string>) {
    const links = [...md.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map(m => m[1]);
    return { links: links.length, valid: links.filter(u => urls.has(u)).length, topics: (md.match(/^###/gm) ?? []).length };
}

// ---------- Judge (blind, order randomized) ----------
async function judgeJson(prompt: string, kind: 'array' | 'object'): Promise<any> {
    let last: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
        const txt = await judge(prompt + '\nIMPORTANT: Output strictly valid JSON. Do not use double quotes inside string values (use 「」 instead).');
        try {
            return kind === 'array'
                ? parseArray(txt)
                : JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
        } catch (e) { last = e; console.log(`  [judge] invalid JSON, retry ${attempt}/3`); }
    }
    throw last;
}

async function judge(prompt: string): Promise<string> {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: JUDGE, messages: [{ role: 'user', content: prompt }], usage: { include: true } }),
        signal: AbortSignal.timeout(300_000),
    });
    const b: any = await res.json();
    if (b.error) throw new Error(JSON.stringify(b.error));
    return b.choices[0].message.content;
}

async function judgeArticles(sample: Article[], on: Run, off: Run) {
    const verdicts: any[] = [];
    for (let i = 0; i < sample.length; i += BATCH_SIZE) {
        const batch = sample.slice(i, i + BATCH_SIZE).filter(a => on.items[a.id] && off.items[a.id]);
        const swap: Record<string, boolean> = {};
        const items = batch.map(a => {
            swap[a.id] = Math.random() < 0.5;
            const [A, B] = swap[a.id] ? [off.items[a.id], on.items[a.id]] : [on.items[a.id], off.items[a.id]];
            const pick = (o: any) => ({ titleJa: o.titleJa, summary: o.summary, country: o.country, category: o.category, importanceScore: o.importanceScore });
            return { id: a.id, source: a.source, title: a.title, description: a.description, A: pick(A), B: pick(B) };
        });
        const prompt = `You are a strict bilingual (English/Japanese) news editor evaluating two AI outputs for the same English news item.
The task given to the AI was: translate the title to Japanese (titleJa), write a ~100-char Japanese summary (summary) of the description, pick the ISO country code of the primary location ("XX" if global), pick a category from [Politics, Conflict, Economy, Society, Science, Environment, Disaster, Sports, Entertainment], and give an importance score 0-100.

For EACH item compare A and B on: translation accuracy, faithfulness to the source (no added facts), natural Japanese, correct country/category, and sensible importance.
Return ONLY a JSON array of objects: {"id": "...", "winner": "A" | "B" | "tie", "severity": "none" | "minor" | "major", "errorsA": "short Japanese note or empty", "errorsB": "short Japanese note or empty"}.
"severity" = how much the losing side is worse ("none" if tie or trivial differences). Only flag real errors (mistranslation, hallucinated facts, wrong country/category), not style preferences.

Items:
${JSON.stringify(items, null, 1)}`;
        const out = await judgeJson(prompt, 'array');
        for (const v of out) {
            if (!(v.id in swap)) continue;
            const s = swap[v.id];
            const winner = v.winner === 'tie' ? 'tie' : ((v.winner === 'A') !== s ? 'ON' : 'OFF');
            verdicts.push({ id: v.id, winner, severity: v.severity, errorsON: s ? v.errorsB : v.errorsA, errorsOFF: s ? v.errorsA : v.errorsB });
        }
        console.log(`  [judge] articles ${i + 1}-${i + batch.length} done`);
    }
    return verdicts;
}

async function judgeSummary(all: Article[], on: Run, off: Run) {
    const s = Math.random() < 0.5;
    const [A, B] = s ? [off.summary, on.summary] : [on.summary, off.summary];
    const input = all.map(a => `- [${a.source}] ${a.title} (${a.country}) Link: ${a.url} : ${a.description}`).join('\n');
    const prompt = `You are a strict news editor. Two AI drafts (A and B) of a Japanese daily world-news digest were written from the same input articles.
Requirements given to the AI: pick 4-5 major topics, Japanese overview per topic, distinct perspectives from different sources with markdown links using the EXACT provided URLs, and a Global Headlines section.

Evaluate: topic selection (are they really the biggest stories?), factual faithfulness to the input (no hallucination), quality of the "perspectives" (genuinely different angles?), Japanese quality, format/link compliance.
Return ONLY JSON: {"winner": "A" | "B" | "tie", "margin": "slight" | "clear" | "large", "scoreA": 1-10, "scoreB": 1-10, "reason": "3-5 sentences in Japanese", "errorsA": "Japanese", "errorsB": "Japanese"}

Input articles:
${input}

=== Draft A ===
${A}

=== Draft B ===
${B}`;
    const v = await judgeJson(prompt, 'object');
    const map = (w: string) => w === 'tie' ? 'tie' : ((w === 'A') !== s ? 'ON' : 'OFF');
    return { winner: map(v.winner), margin: v.margin, scoreON: s ? v.scoreB : v.scoreA, scoreOFF: s ? v.scoreA : v.scoreB, reason: v.reason, errorsON: s ? v.errorsB : v.errorsA, errorsOFF: s ? v.errorsA : v.errorsB };
}

async function main() {
    const feed = JSON.parse(fs.readFileSync(path.join(DAILY_DIR, DATE, 'feed.json'), 'utf-8'));
    const all: Article[] = feed.articles.filter((a: Article) => a.sourceUrl && a.titleJa && a.description);
    const sample = sampleArticles(all, SAMPLE);
    const urls = new Set(all.map(a => a.url));
    console.log(`Date ${DATE}: ${all.length} articles, sample ${sample.length}, model ${MODEL}, judge ${JUDGE}`);

    const outDir = path.join(ROOT, 'compare-results', `thinking-ab_${DATE}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
    fs.mkdirSync(outDir, { recursive: true });

    // --reuse <dir>: reuse Gemini runs from a previous invocation (skip API calls)
    const reuse = arg('reuse');
    let runs: Run[];
    if (reuse) {
        const saved = JSON.parse(fs.readFileSync(path.join(reuse, 'runs.json'), 'utf-8'));
        sample.splice(0, sample.length, ...saved.sample);
        runs = saved.runs;
        console.log(`Reusing Gemini runs from ${reuse}`);
    } else {
        runs = await Promise.all([
            runCondition('ON-1', true, sample, all),
            runCondition('ON-2', true, sample, all),
            runCondition('OFF-1', false, sample, all),
            runCondition('OFF-2', false, sample, all),
        ]);
    }
    fs.writeFileSync(path.join(outDir, 'runs.json'), JSON.stringify({ sample, runs }, null, 2));
    const [on1, on2, off1, off2] = runs;

    console.log('Judging (blind)...');
    const [verdicts, sumVerdict] = await Promise.all([judgeArticles(sample, on1, off1), judgeSummary(all, on1, off1)]);

    const perDay = (r: Run) => r.enrichUsage.cost * (all.length / sample.length) + r.summaryUsage.cost * 2;
    const result = {
        date: DATE, model: MODEL, judge: JUDGE,
        cost: Object.fromEntries([on1, on2, off1, off2].map(r => [r.label, {
            enrichOutTokens: r.enrichUsage.outTok, enrichThoughtTokens: r.enrichUsage.thoughtTok,
            summaryOutTokens: r.summaryUsage.outTok, summaryThoughtTokens: r.summaryUsage.thoughtTok,
            enrichSec: r.enrichUsage.ms / 1000, summarySec: r.summaryUsage.ms / 1000,
            perDay: perDay(r), perMonth: perDay(r) * 30,
        }])),
        agreement: {
            'ON-1 vs ON-2 (noise)': agreement(on1, on2, sample),
            'OFF-1 vs OFF-2 (noise)': agreement(off1, off2, sample),
            'ON-1 vs OFF-1': agreement(on1, off1, sample),
            'ON-2 vs OFF-2': agreement(on2, off2, sample),
            'ON-1 vs production': agreement(on1, { items: Object.fromEntries(sample.map(a => [a.id, a])) } as Run, sample),
            'OFF-1 vs production': agreement(off1, { items: Object.fromEntries(sample.map(a => [a.id, a])) } as Run, sample),
        },
        summaryLinks: Object.fromEntries([on1, on2, off1, off2].map(r => [r.label, linkStats(r.summary, urls)])),
        judgeArticles: {
            ON: verdicts.filter(v => v.winner === 'ON').length,
            OFF: verdicts.filter(v => v.winner === 'OFF').length,
            tie: verdicts.filter(v => v.winner === 'tie').length,
            majorON: verdicts.filter(v => v.winner === 'ON' && v.severity === 'major').length,
            majorOFF: verdicts.filter(v => v.winner === 'OFF' && v.severity === 'major').length,
        },
        judgeSummary: sumVerdict,
        verdicts,
    };

    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(result, null, 2));
    for (const r of [on1, off1]) fs.writeFileSync(path.join(outDir, `summary_${r.label}.md`), r.summary);

    const { verdicts: _v, ...brief } = result;
    console.log(JSON.stringify(brief, null, 2));
    console.log(`\nSaved: ${outDir}`);
}

main().catch(e => { console.error(e); process.exit(1); });
