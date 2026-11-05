/**
 * Model comparison tool: runs the production prompts against OpenRouter models
 * and compares the results with what Gemini produced in production (feed.json).
 *
 * Usage:
 *   npm run compare -- [--date YYYY-MM-DD] [--sample 30] [--models a,b,c] [--no-summary]
 *
 * Requires OPENROUTER_API_KEY in .env. Gemini credits are NOT needed:
 * the baseline is the already-generated public/data/daily/<date>/feed.json.
 */
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { Article } from '../backend/types';
import { buildEnrichPrompt, buildSummaryPrompt } from '../backend/prompts';
dotenv.config();

const ROOT = path.join(__dirname, '../..');
const DAILY_DIR = path.join(ROOT, 'public/data/daily');
const OUT_ROOT = path.join(ROOT, 'compare-results');
const BATCH_SIZE = 10; // same as batch-runner.ts
const DAYS_PER_MONTH = 30;

const DEFAULT_MODELS = [
    'google/gemini-2.5-flash',      // production model via OpenRouter (cost/variance reference)
    'google/gemini-3.5-flash-lite', // what gemini-2.5-flash is auto-routed to from 2026-12-01
    'openai/gpt-oss-120b',
    'moonshotai/kimi-k2.5',
    'qwen/qwen3.8-flash',
    'deepseek/deepseek-v4.1-flash',
];

// ---------- CLI ----------
function parseArgs() {
    const args = process.argv.slice(2);
    const get = (name: string) => {
        const i = args.indexOf(`--${name}`);
        return i >= 0 ? args[i + 1] : undefined;
    };
    const dates = fs.readdirSync(DAILY_DIR).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    const date = get('date') ?? dates[dates.length - 1];
    const sample = parseInt(get('sample') ?? '30', 10);
    const models = (get('models') ?? process.env.COMPARE_MODELS ?? DEFAULT_MODELS.join(','))
        .split(',').map(s => s.trim()).filter(Boolean);
    const summary = !args.includes('--no-summary');
    return { date, sample, models, summary };
}

// ---------- OpenRouter ----------
interface CallResult {
    text: string;
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    cost: number;      // USD (as reported by OpenRouter)
    latencyMs: number;
    provider?: string;
    error?: string;
}

async function callOpenRouter(model: string, prompt: string): Promise<CallResult> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not defined in .env');

    for (let attempt = 1; attempt <= 3; attempt++) {
        const started = Date.now();
        try {
            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'X-Title': 'NewsScope Daily model comparison',
                },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: prompt }],
                    usage: { include: true },
                }),
                signal: AbortSignal.timeout(300_000),
            });
            const body: any = await res.json().catch(() => ({}));
            if (!res.ok || body.error) {
                const msg = `HTTP ${res.status}: ${body?.error?.message ?? JSON.stringify(body).slice(0, 300)}`;
                const retryable = res.status === 429 || res.status >= 500;
                if (retryable && attempt < 3) {
                    console.log(`  [${model}] ${msg} — retry ${attempt}/2 in 20s`);
                    await new Promise(r => setTimeout(r, 20_000));
                    continue;
                }
                return emptyResult(Date.now() - started, msg);
            }
            const u = body.usage ?? {};
            return {
                text: body.choices?.[0]?.message?.content ?? '',
                promptTokens: u.prompt_tokens ?? 0,
                completionTokens: u.completion_tokens ?? 0,
                reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
                cost: u.cost ?? 0,
                latencyMs: Date.now() - started,
                provider: body.provider,
            };
        } catch (e: any) {
            if (attempt < 3) {
                console.log(`  [${model}] ${e?.message} — retry ${attempt}/2 in 20s`);
                await new Promise(r => setTimeout(r, 20_000));
                continue;
            }
            return emptyResult(Date.now() - started, String(e?.message ?? e));
        }
    }
    return emptyResult(0, 'unreachable');
}

function emptyResult(latencyMs: number, error: string): CallResult {
    return { text: '', promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cost: 0, latencyMs, error };
}

// ---------- Parsing (production logic first, then lenient) ----------
function parseEnrich(text: string): { data: any[] | null; strict: boolean } {
    try {
        const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim(); // same as gemini-client.ts
        const d = JSON.parse(jsonStr);
        if (Array.isArray(d)) return { data: d, strict: true };
    } catch { /* fall through */ }
    try {
        const s = text.indexOf('['), e = text.lastIndexOf(']');
        if (s >= 0 && e > s) {
            const d = JSON.parse(text.slice(s, e + 1));
            if (Array.isArray(d)) return { data: d, strict: false };
        }
        const o = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
        const arr = Object.values(o).find(v => Array.isArray(v));
        if (arr) return { data: arr as any[], strict: false };
    } catch { /* fall through */ }
    return { data: null, strict: false };
}

// ---------- Sampling ----------
function sampleArticles(all: Article[], n: number): Article[] {
    // Round-robin across sources so every feed is represented.
    const bySource = new Map<string, Article[]>();
    for (const a of all) {
        if (!bySource.has(a.source)) bySource.set(a.source, []);
        bySource.get(a.source)!.push(a);
    }
    const out: Article[] = [];
    const queues = [...bySource.values()];
    while (out.length < n && queues.some(q => q.length)) {
        for (const q of queues) {
            if (q.length && out.length < n) out.push(q.shift()!);
        }
    }
    return out;
}

const hasJapanese = (s: any) => typeof s === 'string' && /[぀-ヿ一-鿿]/.test(s);

// ---------- Per-model run ----------
interface ModelRun {
    model: string;
    items: Record<string, any>;  // id -> model output
    calls: CallResult[];
    parseFailures: number;
    lenientParses: number;
    errors: string[];
    summaryMd?: string;
    summaryCall?: CallResult;
}

async function runModel(model: string, sample: Article[], summaryInput: Article[] | null, date: string): Promise<ModelRun> {
    const run: ModelRun = { model, items: {}, calls: [], parseFailures: 0, lenientParses: 0, errors: [] };
    for (let i = 0; i < sample.length; i += BATCH_SIZE) {
        const batch = sample.slice(i, i + BATCH_SIZE);
        const r = await callOpenRouter(model, buildEnrichPrompt(batch));
        run.calls.push(r);
        if (r.error) {
            run.errors.push(r.error);
            run.parseFailures++;
            console.log(`  [${model}] batch ${i / BATCH_SIZE + 1}: ERROR ${r.error}`);
            continue;
        }
        const { data, strict } = parseEnrich(r.text);
        if (!data) {
            run.parseFailures++;
            run.errors.push(`JSON parse failed: ${r.text.slice(0, 200)}`);
        } else {
            if (!strict) run.lenientParses++;
            for (const d of data) if (d?.id) run.items[d.id] = d;
        }
        console.log(`  [${model}] batch ${i / BATCH_SIZE + 1}: ${(r.latencyMs / 1000).toFixed(1)}s, $${r.cost.toFixed(5)}${data ? '' : ' (parse failed)'}`);
    }
    if (summaryInput) {
        const r = await callOpenRouter(model, buildSummaryPrompt(summaryInput, 'world', date));
        run.summaryCall = r;
        run.summaryMd = r.error ? `**ERROR:** ${r.error}` : r.text;
        console.log(`  [${model}] world summary: ${(r.latencyMs / 1000).toFixed(1)}s, $${r.cost.toFixed(5)}`);
    }
    return run;
}

// ---------- Metrics ----------
function metrics(run: ModelRun, sample: Article[], dayArticleCount: number) {
    let matched = 0, country = 0, category = 0, scoreDiff = 0, scoreN = 0, jaTitle = 0, jaSummary = 0, sumLen = 0;
    for (const a of sample) {
        const m = run.items[a.id];
        if (!m) continue;
        matched++;
        if (m.country === a.country) country++;
        if (m.category === a.category) category++;
        if (typeof m.importanceScore === 'number' && typeof a.importanceScore === 'number') {
            scoreDiff += Math.abs(m.importanceScore - a.importanceScore); scoreN++;
        }
        if (hasJapanese(m.titleJa)) jaTitle++;
        if (hasJapanese(m.summary)) jaSummary++;
        sumLen += (m.summary ?? '').length;
    }
    const enrichCost = run.calls.reduce((s, c) => s + c.cost, 0);
    const enrichLatency = run.calls.reduce((s, c) => s + c.latencyMs, 0);
    const pt = run.calls.reduce((s, c) => s + c.promptTokens, 0);
    const ct = run.calls.reduce((s, c) => s + c.completionTokens, 0);
    const rt = run.calls.reduce((s, c) => s + c.reasoningTokens, 0);
    const summaryCost = run.summaryCall?.cost ?? 0;
    // Production: all day articles enriched + 2 summaries (world + regional).
    const perDay = (sample.length ? enrichCost * (dayArticleCount / sample.length) : 0) + summaryCost * 2;
    const pct = (x: number) => matched ? (100 * x / matched) : 0;
    return {
        matched, total: sample.length,
        countryPct: pct(country), categoryPct: pct(category),
        scoreMae: scoreN ? scoreDiff / scoreN : NaN,
        jaTitlePct: pct(jaTitle), jaSummaryPct: pct(jaSummary),
        avgSummaryLen: matched ? sumLen / matched : 0,
        promptTokens: pt, completionTokens: ct, reasoningTokens: rt,
        enrichCost, summaryCost, enrichLatency,
        summaryLatency: run.summaryCall?.latencyMs ?? 0,
        perDay, perMonth: perDay * DAYS_PER_MONTH,
        parseFailures: run.parseFailures, lenientParses: run.lenientParses,
        providers: [...new Set(run.calls.map(c => c.provider).filter(Boolean))].join(', '),
    };
}

// ---------- HTML report ----------
const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function renderReport(date: string, sample: Article[], runs: ModelRun[], ms: ReturnType<typeof metrics>[], baselineSummary: string | null, dayCount: number): string {
    const rows = runs.map((r, i) => {
        const m = ms[i];
        return `<tr>
<td class="model">${esc(r.model)}<div class="sub">${esc(m.providers)}</div></td>
<td>${m.matched}/${m.total}${m.parseFailures ? ` <span class="bad">(${m.parseFailures} batch失敗)</span>` : ''}${m.lenientParses ? ` <span class="warn">(${m.lenientParses} 要寛容パース)</span>` : ''}</td>
<td>${m.countryPct.toFixed(0)}%</td>
<td>${m.categoryPct.toFixed(0)}%</td>
<td>${isNaN(m.scoreMae) ? '-' : m.scoreMae.toFixed(1)}</td>
<td>${m.jaTitlePct.toFixed(0)}% / ${m.jaSummaryPct.toFixed(0)}%</td>
<td>${m.avgSummaryLen.toFixed(0)}</td>
<td>${m.promptTokens.toLocaleString()} / ${m.completionTokens.toLocaleString()}${m.reasoningTokens ? `<div class="sub">うち推論 ${m.reasoningTokens.toLocaleString()}</div>` : ''}</td>
<td>${(m.enrichLatency / 1000).toFixed(0)}s${m.summaryLatency ? ` + ${(m.summaryLatency / 1000).toFixed(0)}s` : ''}</td>
<td>$${(m.enrichCost + m.summaryCost).toFixed(4)}</td>
<td><b>$${m.perDay.toFixed(3)}</b> / $${m.perMonth.toFixed(2)}</td>
</tr>`;
    }).join('\n');

    const cards = sample.map(a => {
        const modelRows = runs.map(r => {
            const m = r.items[a.id];
            if (!m) return `<tr><td class="model">${esc(r.model)}</td><td colspan="4" class="bad">出力なし</td></tr>`;
            const diff = (k: string) => m[k] !== (a as any)[k] ? ' class="diff"' : '';
            const sd = Math.abs((m.importanceScore ?? 0) - (a.importanceScore ?? 0)) >= 20 ? ' class="diff"' : '';
            return `<tr><td class="model">${esc(r.model)}</td>
<td><div class="ja">${esc(m.titleJa)}</div><div class="sum">${esc(m.summary)}</div></td>
<td${diff('country')}>${esc(m.country)}</td><td${diff('category')}>${esc(m.category)}</td><td${sd}>${esc(m.importanceScore)}</td></tr>`;
        }).join('');
        return `<details class="card"><summary><span class="src">${esc(a.source)}</span> ${esc(a.title)}</summary>
<p class="desc">${esc(a.description)} <a href="${esc(a.url)}" target="_blank" rel="noopener">原文</a></p>
<table class="items"><thead><tr><th>モデル</th><th>タイトル / 要約</th><th>国</th><th>分類</th><th>重要度</th></tr></thead><tbody>
<tr class="base"><td class="model">本番 Gemini 2.5 Flash</td><td><div class="ja">${esc(a.titleJa)}</div><div class="sum">${esc(a.summary)}</div></td>
<td>${esc(a.country)}</td><td>${esc(a.category)}</td><td>${esc(a.importanceScore)}</td></tr>
${modelRows}</tbody></table></details>`;
    }).join('\n');

    const summaries = baselineSummary === null && !runs.some(r => r.summaryMd) ? '' : `
<h2>世界サマリー（同じ入力 ${dayCount} 記事）</h2>
<p class="note">各カラムを横スクロールで比較できます。</p>
<div class="sumgrid">
${baselineSummary !== null ? `<div class="sumcol"><h3>本番 Gemini 2.5 Flash</h3><div class="md" data-md="${esc(baselineSummary)}"></div></div>` : ''}
${runs.filter(r => r.summaryMd).map(r => `<div class="sumcol"><h3>${esc(r.model)}</h3><div class="md" data-md="${esc(r.summaryMd)}"></div></div>`).join('\n')}
</div>`;

    return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>モデル比較 ${esc(date)}</title>
<style>
:root{--bg:#fff;--fg:#1d1d1f;--mut:#6b6b70;--line:#e3e3e8;--base:#f3f7ff;--diff:#fff1d6;--bad:#c62828;--warn:#b26a00}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--fg:#ececf0;--mut:#9a9aa3;--line:#2e2e33;--base:#1c2433;--diff:#3a2d12;--bad:#ff6b6b;--warn:#f0b04a}}
body{background:var(--bg);color:var(--fg);font:14px/1.6 system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif;margin:0;padding:24px 16px;max-width:1400px;margin:auto}
h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 8px}.note,.sub{color:var(--mut);font-size:12px}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{font-size:12px;color:var(--mut);font-weight:600;white-space:nowrap}td.model{white-space:nowrap;font-weight:600}
.metrics td{white-space:nowrap}.bad{color:var(--bad)}.warn{color:var(--warn)}
.card{border:1px solid var(--line);border-radius:8px;margin:8px 0;padding:8px 12px}.card summary{cursor:pointer;font-weight:600}
.src{color:var(--mut);font-weight:400;font-size:12px;margin-right:6px}.desc{color:var(--mut);margin:8px 0}
tr.base{background:var(--base)}td.diff{background:var(--diff)}.ja{font-weight:600}.sum{color:var(--fg)}
.sumgrid{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(360px,1fr);gap:12px;overflow-x:auto}
.sumcol{border:1px solid var(--line);border-radius:8px;padding:12px;font-size:13px}.sumcol h3{margin:0 0 8px;font-size:14px}
.md h1{font-size:16px}.md h2{font-size:15px;margin:12px 0 4px}.md h3{font-size:14px}a{color:inherit}
</style></head><body>
<h1>モデル比較レポート — ${esc(date)}</h1>
<p class="note">記事 ${sample.length} 件（全 ${dayCount} 件からソース均等にサンプリング）を本番と同じプロンプトで処理。一致率は本番 Gemini 2.5 Flash の出力との比較（正解ではなく「本番との差」）。
コストは OpenRouter の実請求額（クレジット購入手数料 5.5% は含まず）。1日あたり = 記事処理 × ${dayCount}/${sample.length} + サマリー × 2。</p>
<div class="scroll"><table class="metrics"><thead><tr>
<th>モデル</th><th>取得件数</th><th>国 一致</th><th>分類 一致</th><th>重要度 平均差</th><th>日本語率 題/要約</th><th>要約 平均文字数</th>
<th>トークン 入/出</th><th>所要時間</th><th>今回の費用</th><th>推定 1日 / 1ヶ月</th></tr></thead><tbody>
${rows}
</tbody></table></div>
<h2>記事ごとの比較</h2>
<p class="note">黄色 = 本番と異なる（重要度は差20以上）。クリックで展開。</p>
${cards}
${summaries}
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
<script>document.querySelectorAll('.md').forEach(function(el){try{el.innerHTML=marked.parse(el.dataset.md)}catch(e){el.textContent=el.dataset.md}});</script>
</body></html>`;
}

// ---------- Main ----------
async function main() {
    const { date, sample: n, models, summary } = parseArgs();
    const dayDir = path.join(DAILY_DIR, date);
    const feed = JSON.parse(fs.readFileSync(path.join(dayDir, 'feed.json'), 'utf-8'));
    // Only real RSS articles that Gemini enriched (skip summary items etc.)
    const all: Article[] = feed.articles.filter((a: Article) => a.sourceUrl && a.titleJa && a.description);
    const sample = sampleArticles(all, n);
    const baselinePath = path.join(dayDir, 'summary_world.md');
    const baselineSummary = summary && fs.existsSync(baselinePath) ? fs.readFileSync(baselinePath, 'utf-8') : null;

    console.log(`Date ${date}: ${all.length} articles, sampling ${sample.length}. Models: ${models.join(', ')}`);
    console.log(summary ? 'World summary comparison: ON' : 'World summary comparison: OFF');

    // Models run in parallel; batches within a model run sequentially.
    const runs = await Promise.all(models.map(m => runModel(m, sample, summary ? all : null, date)));
    const ms = runs.map(r => metrics(r, sample, all.length));

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outDir = path.join(OUT_ROOT, `${date}_${stamp}`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ date, sampleIds: sample.map(a => a.id), runs, metrics: ms }, null, 2));
    fs.writeFileSync(path.join(outDir, 'report.html'), renderReport(date, sample, runs, ms, baselineSummary, all.length));

    console.log('\nModel'.padEnd(36) + 'country  category  scoreΔ   $/day    $/month');
    runs.forEach((r, i) => {
        const m = ms[i];
        console.log(r.model.padEnd(35) +
            `${m.countryPct.toFixed(0).padStart(5)}%  ${m.categoryPct.toFixed(0).padStart(6)}%  ${(isNaN(m.scoreMae) ? '-' : m.scoreMae.toFixed(1)).padStart(6)}  ${m.perDay.toFixed(3).padStart(7)}  ${m.perMonth.toFixed(2).padStart(7)}` +
            (m.parseFailures ? `  (${m.parseFailures} failed)` : ''));
    });
    console.log(`\nReport: ${path.join(outDir, 'report.html')}`);
}

main().catch(e => { console.error(e); process.exit(1); });
