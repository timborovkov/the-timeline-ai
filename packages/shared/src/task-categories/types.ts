import { z } from 'zod';

export const TASK_CATEGORY_TAXONOMY_VERSION = 'task-categories-v1';

export const TASK_CATEGORIES = [
  'engineering',
  'product',
  'design',
  'research',
  'sales',
  'marketing',
  'customer_success',
  'operations',
  'finance',
  'legal_compliance',
  'people_recruiting',
  'it_security',
  'strategy_planning',
  'administrative',
  'other',
] as const;

export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export const UNCATEGORIZED_TASK_CATEGORY_FILTER = 'uncategorized' as const;
export type TaskCategoryFilterKey = TaskCategory | typeof UNCATEGORIZED_TASK_CATEGORY_FILTER;
export type TaskCategoryMode = 'automatic' | 'manual';
export type TaskCategorySource = 'llm' | 'user';
export type TaskCategoryStatus = 'pending' | 'ready' | 'failed';

export const taskCategorySchema = z.enum(TASK_CATEGORIES);
export const taskCategoryModeSchema = z.enum(['automatic', 'manual']);
export const taskCategorySourceSchema = z.enum(['llm', 'user']);
export const taskCategoryStatusSchema = z.enum(['pending', 'ready', 'failed']);

export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  engineering: 'Engineering',
  product: 'Product',
  design: 'Design',
  research: 'Research',
  sales: 'Sales',
  marketing: 'Marketing',
  customer_success: 'Customer Success',
  operations: 'Operations',
  finance: 'Finance',
  legal_compliance: 'Legal & Compliance',
  people_recruiting: 'People & Recruiting',
  it_security: 'IT & Security',
  strategy_planning: 'Strategy & Planning',
  administrative: 'Administrative',
  other: 'Other',
};

export const TASK_CATEGORY_DEFINITIONS: Record<TaskCategory, string> = {
  engineering: 'Code, APIs, infrastructure, bugs, deployments, and technical implementation.',
  product: 'Product requirements, roadmaps, prioritization, discovery decisions, and MVP scope.',
  design: 'UX/UI, brand, prototypes, design systems, illustrations, and creative production.',
  research: 'User or market research, analysis, experiments, due diligence, and synthesis.',
  sales:
    'Prospecting, proposals, demos, commercial negotiation, opportunities, and closing new business.',
  marketing: 'Campaigns, content, events, SEO, communications, PR, and demand generation.',
  customer_success:
    'Existing-customer onboarding, support, adoption, training, QBRs, and renewals.',
  operations:
    'Substantive internal processes, vendors, logistics, procurement, facilities, and cross-team execution.',
  finance:
    'Billing, accounting, budgets, payroll execution, tax, reconciliation, and financial reporting.',
  legal_compliance:
    'Contracts, privacy, policy, regulation, legal risk, compliance evidence, and audits.',
  people_recruiting: 'Hiring, interviews, teammate onboarding, performance, culture, and benefits.',
  it_security:
    'Employee access, devices, identity, security controls, incidents, and internal systems.',
  strategy_planning:
    'Company planning, OKRs, partnerships, executive initiatives, and operating reviews.',
  administrative:
    'Scheduling, forms, travel, routine coordination, registration, and record maintenance.',
  other:
    'Domain-specific work outside these business functions, such as clinical care, teaching, agriculture, performing arts, conservation, or hospitality craft.',
};

export const TASK_CATEGORY_OPTIONS = TASK_CATEGORIES.map((value) => ({
  value,
  label: TASK_CATEGORY_LABELS[value],
}));

export function taskCategoryLabel(category: TaskCategory | null | undefined): string {
  return category ? TASK_CATEGORY_LABELS[category] : 'Uncategorized';
}
