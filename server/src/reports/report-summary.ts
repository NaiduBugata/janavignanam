import { discoverGroqApiKeys } from '../ai/groq-keys';
import {
  constituencyName,
  formatLocation,
  formatLongDate,
  type ReportArticle,
  type ReportStats,
} from './report-stats';

const SYSTEM_PROMPT =
  'You are a senior political intelligence analyst preparing a concise executive ' +
  'briefing for a Member of Parliament. Write in clear, professional English. ' +
  'Produce a single cohesive summary of 150-250 words (no bullet lists, no headings). ' +
  'Cover: the overall constituency situation, major positive developments, major ' +
  'concerns/problems, departments that require attention, and the general public ' +
  'sentiment. Be factual and grounded strictly in the data provided. Do not invent ' +
  'specifics that are not present.';

export function templateSummary(target: string, stats: ReportStats): string {
  const name = constituencyName();
  const when = formatLongDate(target);
  if (!stats.total) {
    return (
      `No categorized news was recorded for ${name} constituency on ${when}. ` +
      'There are no developments, problems, or announcements to report for this period. ' +
      'Monitoring continues and the next report will capture any newly published news.'
    );
  }
  let sentiment = 'balanced';
  if (stats.negative > stats.positive)
    sentiment = 'predominantly negative, reflecting public concerns';
  else if (stats.positive > stats.negative) sentiment = 'largely positive';
  const parts = [
    `On ${when}, ${stats.total} categorized news items were recorded across ${name} constituency. ` +
      `Overall public sentiment was ${sentiment}, with ${stats.positive} positive, ${stats.negative} negative, ` +
      `and ${stats.statement} statement-type reports.`,
  ];
  if (stats.problems) {
    const department =
      stats.action_items[0]?.department || 'relevant departments';
    parts.push(
      `${stats.problems} issues require attention (${stats.high_priority_problems} high priority), ` +
        `concentrated in ${stats.most_affected_mandal} mandal. The ${department} and related ` +
        'departments should prioritise these grievances.',
    );
  } else {
    parts.push('No actionable problems were flagged during this period.');
  }
  if (stats.positive_items[0])
    parts.push(
      `Notable positive developments include: ${stats.positive_items[0].title}.`,
    );
  parts.push(
    `The most active category was ${stats.most_common_category}. Most reported locations were ` +
      `${stats.most_affected_mandal} (mandal) and ${stats.most_affected_village} (village).`,
  );
  return parts.join(' ');
}

function context(target: string, stats: ReportStats): string {
  const lines = [
    `Constituency: ${constituencyName()}`,
    `Report date: ${formatLongDate(target)}`,
    `Total articles: ${stats.total}`,
    `Positive: ${stats.positive}, Negative: ${stats.negative}, Statement: ${stats.statement}, Neutral: ${stats.neutral}`,
    `Problems identified: ${stats.problems} (high priority: ${stats.high_priority_problems})`,
    `Most common category: ${stats.most_common_category}`,
    `Most affected mandal: ${stats.most_affected_mandal}, village: ${stats.most_affected_village}`,
  ];
  const categories = stats.category_summary
    .filter((item) => item.count)
    .map((item) => `${item.name}: ${item.count}`);
  if (categories.length)
    lines.push(`Category breakdown: ${categories.join(', ')}`);
  if (stats.action_items.length) {
    lines.push('Top problems requiring attention:');
    for (const item of stats.action_items.slice(0, 6)) {
      lines.push(
        `- [${item.priority}] ${item.title} (${item.category}, ${formatLocation(item.location)}) -> ${item.department}`,
      );
    }
  }
  if (stats.positive_items.length) {
    lines.push('Positive developments:');
    for (const item of stats.positive_items.slice(0, 5)) {
      lines.push(
        `- ${item.title} (${item.category}, ${formatLocation(item.location)})`,
      );
    }
  }
  return lines.join('\n');
}

/** Groq executive summary. A stats template is used when Groq is unavailable. */
export async function generateExecutiveSummary(
  target: string,
  _articles: ReportArticle[],
  stats: ReportStats,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const keys = discoverGroqApiKeys();
  if (!keys.length) return templateSummary(target, stats);
  try {
    const response = await fetchImpl(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${keys[0]}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
          temperature: 0.3,
          max_tokens: 500,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Constituency data for the day:\n\n${context(target, stats)}`,
            },
          ],
        }),
      },
    );
    if (!response.ok) return templateSummary(target, stats);
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = (body.choices?.[0]?.message?.content || '').trim();
    return text || templateSummary(target, stats);
  } catch {
    return templateSummary(target, stats);
  }
}
