import { Article } from './types';

// Shared prompt builders so the production batch (Gemini) and the model
// comparison tool (src/tools/compare-models.ts) always send identical prompts.

export const CATEGORY_JA_MAP: { [key: string]: string } = {
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

export function buildEnrichPrompt(articles: Article[]): string {
    return `
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
}

export function buildSummaryPrompt(articles: Article[], type: 'world' | 'regional', date: string, focusRegion?: string): string {
    const context = type === 'world'
        ? `Summarize the top global news stories for ${date}.`
        : `Summarize news with a specific focus on ${focusRegion} for ${date}. Prioritize stories from this region.`;

    const articlesText = articles.map(a =>
        `- [${a.source}] ${a.title} (${a.country}) Link: ${a.url} : ${a.description}`
    ).join('\n');

    return `
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
}
