import { issueTemplates, type IssueTemplate } from "./issueTemplates";

export type IssueInput = {
  title: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  why: string;
  how: string;
  code?: string;
  impact: string;
};

type LighthouseResult = {
  audits: Record<
    string,
    {
      id: string;
      title: string;
      description?: string;
      score: number | null;
    }
  >;
  categories: Record<
    string,
    {
      title?: string;
      score: number | null;
      auditRefs: { id: string }[];
    }
  >;
};

const categoryMap: Record<string, IssueTemplate["category"]> = {
  performance: "speed",
  seo: "seo",
  accessibility: "accessibility",
  "best-practices": "best-practices",
};

const severityFromScore = (score: number | null): IssueInput["severity"] => {
  if (score === null) return "low";
  if (score < 0.5) return "critical";
  if (score < 0.7) return "high";
  if (score < 0.9) return "medium";
  return "low";
};

const stripLinks = (text?: string) =>
  (text ?? "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();

export const extractIssues = (lhr: LighthouseResult): IssueInput[] => {
  const auditToCategory: Record<string, IssueTemplate["category"]> = {};

  for (const [key, category] of Object.entries(lhr.categories)) {
    const mapped = categoryMap[key];
    if (!mapped) continue;
    for (const ref of category.auditRefs) {
      auditToCategory[ref.id] = mapped;
    }
  }

  const issues: IssueInput[] = [];

  for (const audit of Object.values(lhr.audits)) {
    if (audit.score === null || audit.score >= 0.9) continue;

    const template = issueTemplates[audit.id];
    const category = template?.category ?? auditToCategory[audit.id] ?? "speed";
    const severity = template?.severity ?? severityFromScore(audit.score);

    if (template) {
      issues.push({
        title: template.title,
        category,
        severity,
        why: template.why,
        how: template.how,
        code: template.code,
        impact: template.impact,
      });
      continue;
    }

    issues.push({
      title: audit.title || "Performance issue",
      category,
      severity,
      why:
        "This issue is slowing your site or making it harder to use. Fixing it will improve user experience and rankings.",
      how:
        stripLinks(audit.description) ||
        "Follow Lighthouse recommendations to resolve this audit.",
      impact: "Faster load times and improved scores.",
    });
  }

  return issues;
};
