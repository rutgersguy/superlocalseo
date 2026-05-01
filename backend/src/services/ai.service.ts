import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { logger } from '../utils/logger';

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    if (!config.anthropic.apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
    _client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return _client;
}

export interface ReviewContext {
  businessName: string;
  industry: string | null;
  authorName: string;
  rating: number;
  body: string;
  platform: string;
}

export async function draftReviewResponse(ctx: ReviewContext): Promise<string> {
  const client = getClient();

  const isPositive = ctx.rating >= 4;
  const tone = isPositive
    ? 'warm and appreciative — thank them by name and invite them to return'
    : 'empathetic and solution-focused — acknowledge the issue, apologize sincerely, and offer to make it right';

  const prompt = `You are the owner of ${ctx.businessName}${ctx.industry ? `, a ${ctx.industry} business` : ''}, responding to a ${ctx.platform} review.

Review from ${ctx.authorName} (${ctx.rating}/5 stars):
"${ctx.body}"

Write a professional response. Tone: ${tone}.

Rules:
- Address ${ctx.authorName} by name
- Reference something specific they mentioned (not just their rating)
- 2–4 sentences, under 150 words
- No hashtags, no emojis, no generic filler phrases like "We appreciate your feedback"
- Sign off naturally as the business owner, not a customer service rep
- Return ONLY the response text, nothing else`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
  if (!text) throw new Error('Empty response from Claude');

  logger.info('AI review response drafted', { businessName: ctx.businessName, rating: ctx.rating, platform: ctx.platform });
  return text;
}
