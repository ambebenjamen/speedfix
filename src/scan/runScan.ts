import axios from "axios";
import { extractIssues } from "./extractIssues";

type PageSpeedResponse = {
  lighthouseResult: {
    categories: Record<
      string,
      { score: number | null; auditRefs: { id: string }[]; title?: string }
    >;
    audits: Record<string, { id: string; title: string; description?: string; score: number | null }>;
  };
  loadingExperience?: {
    metrics?: Record<
      string,
      {
        percentile: number;
        category: string;
      }
    >;
  };
};

const toScore = (score: number | null | undefined) =>
  score === null || score === undefined ? null : Math.round(score * 100);

const fetchPageSpeed = async (url: string, strategy: "mobile" | "desktop") => {
  const apiKey = process.env.PAGESPEED_API_KEY;
  const params = new URLSearchParams({ url, strategy });
  params.append("category", "performance");
  params.append("category", "accessibility");
  params.append("category", "best-practices");
  params.append("category", "seo");

  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}${
    apiKey ? `&key=${apiKey}` : ""
  }`;

  const { data } = await axios.get<PageSpeedResponse>(endpoint, {
    timeout: 60000,
  });

  return data;
};

export type ScanSummary = {
  scores: {
    speed: number | null;
    seo: number | null;
    accessibility: number | null;
    bestPractices: number | null;
  };
  webVitals: Record<string, { percentile: number; category: string }>;
};

export const runScan = async (url: string) => {
  const [mobile, desktop] = await Promise.all([
    fetchPageSpeed(url, "mobile"),
    fetchPageSpeed(url, "desktop"),
  ]);

  const lhr = mobile.lighthouseResult;
  const issues = extractIssues(lhr);

  const summary: ScanSummary = {
    scores: {
      speed: toScore(lhr.categories.performance?.score ?? null),
      seo: toScore(lhr.categories.seo?.score ?? null),
      accessibility: toScore(lhr.categories.accessibility?.score ?? null),
      bestPractices: toScore(lhr.categories["best-practices"]?.score ?? null),
    },
    webVitals: mobile.loadingExperience?.metrics ?? {},
  };

  return {
    summary,
    issues,
    raw: {
      mobile,
      desktop,
    },
  };
};
