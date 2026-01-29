import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { Article } from './types';
import dotenv from 'dotenv';
dotenv.config();

export class GeminiClient {
    private model: GenerativeModel;

    constructor() {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY is not defined');
        }
        const genAI = new GoogleGenerativeAI(apiKey);
        // Using the latest Gemini 2.5 Flash model for improved performance and reasoning
        this.model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    }

    // Rate Limiting helper: wait for ms (basic implementation)
    private async delay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    public async validateConnection(): Promise<boolean> {
        try {
            // Simple prompt to verify API access and Model existence
            const model = this.model;
            const result = await model.generateContent("ping");
            return !!result.response.text();
        } catch (error) {
            console.error("Gemini Connection Validation Failed:", error);
            return false;
        }
    }

    // Batch processing to reduce API calls (e.g., process 10 articles at once)
    public async enrichBatch(articles: Article[]): Promise<Article[]> {
        const prompt = `
You are a news classifier and translator. Format your response ONLY as a JSON array.
Input is a list of news articles. For EACH article, return an object with:
1. "id": logic to match input (use the provided ID).
2. "country": ISO 3166-1 alpha-2 code of the PRIMARY location. Use "XX" if global/unknown. INFER from content, do not just rely on source country.
3. "category": One of [Politics, Conflict, Economy, Society, Science, Environment, Disaster, Sports, Entertainment].
4. "importanceScore": Integer 0-100.
5. "titleJa": Japanese translation of the title. MUST be in Japanese.

Input JSON:
${JSON.stringify(articles.map(a => ({ id: a.id, title: a.title, snippet: a.snippet, source: a.source })))}
      `;

        try {
            // Dynamic delay: 10s is safe for 15 RPM if we do 1 call per minute effectively?
            // If we do batch, we make fewer calls. 10s is safe enough.
            // Tier 1: Low delay allowed (100ms)
            await this.delay(100);
            const result = await this.model.generateContent(prompt);
            const responseText = result.response.text();
            const jsonStr = responseText.replace(/```json\n?|\n?```/g, '').trim();
            const enrichedData = JSON.parse(jsonStr);

            // Merge enriched data back into articles
            return articles.map(article => {
                const data = enrichedData.find((d: any) => d.id === article.id);
                if (data) {
                    return {
                        ...article,
                        country: data.country,
                        category: data.category,
                        importanceScore: data.importanceScore,
                        titleJa: data.titleJa
                    };
                }
                return article;
            });

        } catch (error) {
            console.error(`Error enriching batch:`, error);
            // Return original articles if batch fails (graceful degradation)
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
            `- [${a.source}] ${a.title} (${a.country}) Link: ${a.link} : ${a.snippet}`
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
# [Title: YYYY-MM-DD World News / Regional Focus]

## Top Topics

### 1. [Topic Heading in Japanese]
**概要:**
[Japanese summary]

**各国の視点:**
- **[Source Name]**: "[Title](URL)" - [Brief Japanese description of their angle]

...

---
**Global Headlines**
- [Bulleted list of minor stories]
    `;

        try {
            await this.delay(5000);
            const result = await this.model.generateContent(prompt);
            return result.response.text();
        } catch (error) {
            console.error('Error generating summary', error);
            return "# Error generating summary";
        }
    }
}
