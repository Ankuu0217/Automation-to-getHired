import type { ApplicationSummary } from '@jobmail/shared';

/**
 * Role category derivation for the Dispatches view.
 *
 * Categories are discovered dynamically from role text using keyword matching.
 * A role can only belong to one category; the first match wins in the order
 * listed below. Roles that match nothing land in "Other".
 */

export const ROLE_CATEGORIES = [
  { id: 'frontend', label: 'Frontend', keywords: ['frontend', 'front-end', 'front end', 'react', 'vue', 'angular', 'svelte', 'ui', 'ux', 'web', 'css', 'html', 'javascript', 'typescript'] },
  { id: 'backend', label: 'Backend', keywords: ['backend', 'back-end', 'back end', 'node', 'nodejs', 'node.js', 'python', 'java', 'go', 'golang', 'ruby', 'php', 'api', 'server', 'spring', 'django', 'flask', 'express'] },
  { id: 'fullstack', label: 'Full Stack', keywords: ['full stack', 'fullstack', 'full-stack', 'mern', 'mean'] },
  { id: 'mobile', label: 'Mobile', keywords: ['mobile', 'ios', 'android', 'flutter', 'react native', 'swift', 'kotlin'] },
  { id: 'devops', label: 'DevOps / SRE', keywords: ['devops', 'sre', 'cloud', 'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'k8s', 'terraform', 'ci/cd', 'infrastructure'] },
  { id: 'data', label: 'Data / ML / AI', keywords: ['data', 'ml', 'ai', 'machine learning', 'deep learning', 'data science', 'data engineer', 'analytics', 'python ml'] },
  { id: 'qa', label: 'QA / Testing', keywords: ['qa', 'test', 'testing', 'automation', 'selenium', 'cypress'] },
  { id: 'product', label: 'Product / Other', keywords: ['product', 'manager', 'program manager', 'project manager'] },
] as const;

export type RoleCategoryId = (typeof ROLE_CATEGORIES)[number]['id'];

/**
 * Categorize a role string. Returns the first matching category id, or 'other'
 * when nothing matches.
 */
export function categorizeRole(role: string | null | undefined): RoleCategoryId | 'other' {
  if (!role) return 'other';
  const normalized = role.toLowerCase();
  for (const category of ROLE_CATEGORIES) {
    if (category.keywords.some((kw) => normalized.includes(kw))) {
      return category.id;
    }
  }
  return 'other';
}

/**
 * Build a display label for a category id.
 */
export function categoryLabel(id: RoleCategoryId | 'other'): string {
  const found = ROLE_CATEGORIES.find((c) => c.id === id);
  return found?.label ?? 'Other';
}

/**
 * Group applications by derived role category. Returns entries sorted by
 * descending count, with the 'other' bucket always last.
 */
export function groupApplicationsByCategory(
  applications: ApplicationSummary[],
): { categoryId: RoleCategoryId | 'other'; label: string; count: number; applications: ApplicationSummary[] }[] {
  const groups = new Map<RoleCategoryId | 'other', ApplicationSummary[]>();
  for (const app of applications) {
    const categoryId = categorizeRole(app.role);
    const list = groups.get(categoryId) ?? [];
    list.push(app);
    groups.set(categoryId, list);
  }

  const entries = [...groups.entries()].map(([categoryId, apps]) => ({
    categoryId,
    label: categoryLabel(categoryId),
    count: apps.length,
    applications: apps,
  }));

  entries.sort((a, b) => {
    if (a.categoryId === 'other') return 1;
    if (b.categoryId === 'other') return -1;
    return b.count - a.count || a.label.localeCompare(b.label);
  });

  return entries;
}

/**
 * Filter applications by a free-text query (company, role, recruiter name/email).
 */
export function searchApplications(
  applications: ApplicationSummary[],
  query: string,
): ApplicationSummary[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return applications;
  return applications.filter(
    (a) =>
      (a.company ?? '').toLowerCase().includes(trimmed) ||
      (a.role ?? '').toLowerCase().includes(trimmed) ||
      (a.hrName ?? '').toLowerCase().includes(trimmed) ||
      a.hrEmail.toLowerCase().includes(trimmed),
  );
}
