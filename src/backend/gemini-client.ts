import { GoogleGenAI } from '@google/genai';
import { Article } from './types';
import dotenv from 'dotenv';
dotenv.config();

export class GeminiClient {
    private ai: GoogleGenAI;
    private modelName = 'gemini-2.5-flash';

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

    private async generateWithRetry(prompt: string, maxRetries = 3): Promise<string> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await this.ai.models.generateContent({
                    model: this.modelName,
                    contents: prompt
                });
                return response.text ?? '';
            } catch (error: any) {
                const status = error?.status ?? error?.code;
                const isRetryable = status === 'UNAVAILABLE' || status === 503 || status === 429;
                if (isRetryable && attempt < maxRetries) {
                    console.log(`API unavailable (attempt ${attempt}/${maxRetries}), waiting 60s...`);
                    await this.delay(60000);
                } else {
                    throw error;
                }
            }
        }
        throw new Error('Max retries exceeded');
    }

    public async validateConnection(): Promise<boolean> {
        try {
            const text = await this.generateWithRetry('ping');
            return !!text;
        } catch (error) {
            console.error("Gemini Connection Validation Failed:", error);
            return false;
        }
    }

    public async enrichBatch(articles: Article[]): Promise<Article[]> {
        const prompt = `
You are a news classifier and translator. Format your response ONLY as a JSON array.
Input is a list of news articles. For EACH article, return an object with:
1. "id": logic to match input (use the provided ID).
2. "country": ISO 3166-1 alpha-2 code of the PRIMARY location. Use "XX" if global/unknown. INFER from content, do not just rely on source country.
3. "category": One of [Politics, Conflict, Economy, Society, Science, Environment, Disaster, Sports, Entertainment].
4. "importanceScore": Integer 0-100.
5. "titleJa": Japanese translation of the title. MUST be in Japanese.
6. "summary": Japanese summary of the content (~100 chars). Use "summary" key.

Input JSON:
${JSON.stringify(articles.map(a => ({ id: a.id, title: a.title, description: a.description, source: a.source })))}
      `;

        try {
            await this.delay(100);
            const responseText = await this.generateWithRetry(prompt);
            const jsonStr = responseText.replace(/```json\n?|\n?```/g, '').trim();
            const enrichedData = JSON.parse(jsonStr);

            const CATEGORY_JA_MAP: { [key: string]: string } = {
                "Politics": "政治",
                "Conflict": "紛争",
                "Economy": "経済",
                "Society": "社会",
                "Science": "科学",
                "Environment": "環境",
                "Disaster": "災害",
                "Sports": "スポーツ",
                "Entertainment": "エンタメ"
            };

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
        const context = type === 'world'
            ? `Summarize the top global news stories for ${date}.`
            : `Summarize news with a specific focus on ${focusRegion} for ${date}. Prioritize stories from this region.`;

        const articlesText = articles.map(a =>
            `- [${a.source}] ${a.title} (${a.country}) Link: ${a.url} : ${a.description}`
        ).join('\n');

        const prompt = `
You are a news editor acting as a bridge between the world and Japan.
${context}

Input Data:
${articlesText}

Requirements:
1. Select 4-5 major topics.
2. For each topic:
   - Provide a Japanese overview (概要).
   - List distinct perspectives from different media sources (各国の視点).
   - Use strict markdown format as shown below.
3. Add a "Global Headlines" section at the bottom for other brief mentions.
4. **IMPORTANT**: For "Perspective" links, you MUST use the provided Link URL. Format: **[Source Name]**: "[Title](URL)" - [Brief Japanese description...]

Format:
#[Title: YYYY - MM - DD World News / Regional Focus]

## Top Topics

### 1.[Topic Heading in Japanese]
** 概要:**
[Japanese summary]

** 各国の視点:**
- ** [Source Name] **: "[Title](URL)" - [Brief Japanese description of their angle]

...

---
** Global Headlines **
-[Bulleted list of minor stories]
            `;

        try {
            await this.delay(5000);
            return await this.generateWithRetry(prompt);
        } catch (error) {
            console.error('Error generating summary:', error);
            return "# Error generating summary";
        }
    }
}
