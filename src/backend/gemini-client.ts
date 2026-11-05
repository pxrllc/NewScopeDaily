import { GoogleGenAI } from '@google/genai';
import { Article } from './types';
import { buildEnrichPrompt, buildSummaryPrompt, CATEGORY_JA_MAP } from './prompts';
import { linkifySummary } from './summary-links';
import dotenv from 'dotenv';
dotenv.config();

export class GeminiClient {
    private ai: GoogleGenAI;
    private modelName = 'gemini-2.5-flash';
    private fallbackModelName = 'gemini-2.5-flash-lite';

    constructor() {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY is not defined');
        }
        this.ai = new GoogleGenAI({ apiKey });
    }

    private async delay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * @param thinking false = thinkingBudget 0. Thinking tokens are billed as output.
     *   A/B test (2026-11, src/tools/thinking-ab.ts): for article translation/classification
     *   thinking cost ~3.5x with no accuracy gain (ON vs OFF diff ≈ ON vs ON noise), so it is
     *   OFF there. For the daily summaries thinking clearly improved quality, so it stays ON.
     */
    private async generateWithRetry(prompt: string, thinking: boolean, maxRetries = 3): Promise<string> {
        const models = [this.modelName, this.fallbackModelName];
        for (const model of models) {
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    const response = await this.ai.models.generateContent({
                        model,
                        contents: prompt,
                        ...(thinking ? {} : { config: { thinkingConfig: { thinkingBudget: 0 } } }),
                    });
                    if (model !== this.modelName) {
                        console.log(`Used fallback model: ${model}`);
                    }
                    return response.text ?? '';
                } catch (error: any) {
                    const status = error?.status ?? error?.code;
                    const isRetryable = status === 'UNAVAILABLE' || status === 503 || status === 429;
                    console.log(`[${model}] Error detail: status=${status} message=${error?.message}`);
                    if (isRetryable && attempt < maxRetries) {
                        console.log(`[${model}] API unavailable (attempt ${attempt}/${maxRetries}), waiting 60s...`);
                        await this.delay(60000);
                    } else if (isRetryable) {
                        console.log(`[${model}] All retries failed, trying next model...`);
                        break; // 次のモデルへ
                    } else {
                        throw error; // リトライ不要なエラーはそのままthrow
                    }
                }
            }
        }
        throw new Error('All models and retries exhausted');
    }

    public async validateConnection(): Promise<boolean> {
        try {
            const text = await this.generateWithRetry('ping', false);
            return !!text;
        } catch (error) {
            console.error("Gemini Connection Validation Failed:", error);
            return false;
        }
    }

    public async enrichBatch(articles: Article[]): Promise<Article[]> {
        const prompt = buildEnrichPrompt(articles);

        try {
            await this.delay(100);
            const responseText = await this.generateWithRetry(prompt, false);
            const jsonStr = responseText.replace(/```json\n?|\n?```/g, '').trim();
            const enrichedData = JSON.parse(jsonStr);

            return articles.map(article => {
                const data = enrichedData.find((d: any) => d.id === article.id);
                if (data) {
                    const catJa = CATEGORY_JA_MAP[data.category] || data.category;
                    return {
                        ...article,
                        country: data.country,
                        category: data.category,
                        categoryJa: catJa,
                        importanceScore: data.importanceScore,
                        titleJa: data.titleJa,
                        summary: data.summary || data.descriptionJa
                    };
                }
                return article;
            });

        } catch (error) {
            console.error(`Error enriching batch:`, error);
            return articles;
        }
    }

    public async classifyArticle(article: Article): Promise<{ country: string; category: string; importanceScore: number; titleJa: string }> {
        // Deprecated, but keeping for compatibility if needed.
        return { country: 'XX', category: 'General', importanceScore: 0, titleJa: article.title };
    }

    public async generateDailySummary(articles: Article[], type: 'world' | 'regional', date: string, focusRegion?: string): Promise<string> {
        const prompt = buildSummaryPrompt(articles, type, date, focusRegion);

        try {
            await this.delay(5000);
            const md = await this.generateWithRetry(prompt, true);
            return linkifySummary(md, articles);
        } catch (error) {
            console.error('Error generating summary:', error);
            return "# Error generating summary";
        }
    }
}
