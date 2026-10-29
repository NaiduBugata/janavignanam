const HIGH_PRIORITY_CATEGORIES = new Set([
  'Crime',
  'Health',
  'Water',
  'Transport',
  'Roads',
]);

const DEPARTMENT_MAP = {
  Transport: 'Roads & Transport (R&B)',
  Roads: 'Roads & Transport (R&B)',
  Infrastructure: 'Infrastructure & Works',
  Health: 'Health & Medical Services',
  Water: 'Rural Water Supply',
  Employment: 'Labour & Employment',
  Agriculture: 'Agriculture & Cooperation',
  Education: 'School Education',
  Crime: 'Police Department',
  'Social Welfare': 'Social Welfare Department',
  Politics: 'General Administration',
  Other: 'General Administration',
};

const ACTION_MAP = {
  Transport: 'Review road safety measures and coordinate with transport authorities for immediate remediation.',
  Roads: 'Inspect affected road sections and initiate repair or maintenance work.',
  Infrastructure: 'Assess infrastructure damage and escalate to relevant engineering department.',
  Health: 'Coordinate with district health officials to address the reported health concern.',
  Water: 'Direct water supply department to investigate and restore services.',
  Employment: 'Engage with labour department and employer representatives to resolve the dispute.',
  Agriculture: 'Connect farmers with agriculture extension officers for support and guidance.',
  Education: 'Follow up with education department officials regarding the reported issue.',
  Crime: 'Bring to the attention of local police and district administration for prompt action.',
  'Social Welfare': 'Coordinate with social welfare officers to ensure beneficiary support.',
  Politics: 'Monitor the situation and engage with local representatives as needed.',
  Other: 'Review the matter and assign to the appropriate department for follow-up.',
};

export function isGrievanceOrProblem(article) {
  if (!article) return false;
  if (article.sentiment === 'Problem' || article.problem || article.problem_id) {
    return true;
  }
  if (article.sentiment === 'Negative') {
    const civicCategories = new Set([
      'Crime',
      'Roads',
      'Transport',
      'Water',
      'Health',
      'Infrastructure',
      'Social Welfare',
      'Employment',
      'Agriculture',
      'Education',
      'Environment',
      'Civic',
    ]);
    if (civicCategories.has(article.category)) return true;
    const txt = `${article.title || ''} ${article.summary || ''}`.toLowerCase();
    if (
      /సమస్య|ఫిర్యాదు|ఇబ్బంది|మరమ్మతు|మురుగు|వరద|కొరత|రోడ్డు|problem|issue|grievance|complaint|repair|drainage|damage/iu.test(
        txt,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function isProblem(article) {
  const sentiment = article?.sentiment || '';
  return sentiment === 'Negative' || sentiment === 'Problem';
}

export function derivePriority(article) {
  if (!isProblem(article)) return 'Low';
  const category = article?.category || '';
  if (HIGH_PRIORITY_CATEGORIES.has(category)) return 'High';
  return 'Medium';
}

export function deriveDepartment(article) {
  const category = article?.category || 'Other';
  return DEPARTMENT_MAP[category] || DEPARTMENT_MAP.Other;
}

export function deriveRecommendedAction(article) {
  const category = article?.category || 'Other';
  return ACTION_MAP[category] || ACTION_MAP.Other;
}

export function deriveProblemSummary(article) {
  if (article?.problem) return article.problem;
  if (isProblem(article)) return article?.summary || '';
  return '';
}

export function enrichArticle(article) {
  return {
    ...article,
    priority: derivePriority(article),
    department: deriveDepartment(article),
    recommendedAction: deriveRecommendedAction(article),
    problemSummary: deriveProblemSummary(article),
    isActionRequired: isProblem(article),
  };
}

export function enrichArticles(articles) {
  return (articles || []).map(enrichArticle);
}

export const PRIORITY_ORDER = { High: 0, Medium: 1, Low: 2 };

import { getArticleSortTime } from './format';

export function sortByPriority(articles) {
  return [...articles].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 3;
    const pb = PRIORITY_ORDER[b.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    return getArticleSortTime(b) - getArticleSortTime(a);
  });
}
