export const AREA_PREFIX = {
  'ai-setup': 'AI',
  architecture: 'ARCH',
  workflow: 'FLOW',
  hosting: 'HOST',
  seo: 'SEO',
  'content-conversion': 'CONV',
  'code-quality': 'CODE',
  performance: 'PERF',
  'process-hygiene': 'PROC',
  security: 'SEC',
  'privacy-legal': 'PRIV',
};

export const AREAS = Object.keys(AREA_PREFIX);

export const AREA_TITLES = {
  'ai-setup': 'AI setup',
  architecture: 'Architecture',
  workflow: 'Delivery workflow',
  hosting: 'Server and hosting',
  seo: 'SEO and discoverability',
  'content-conversion': 'Content and conversion',
  'code-quality': 'Code quality',
  performance: 'Performance',
  'process-hygiene': 'Process and repo hygiene',
  security: 'Security and dependencies',
  'privacy-legal': 'Privacy and legal',
};

// Rules that earlier versions used and that now belong elsewhere. Their findings from earlier runs are not handed back
// to the area for re-checking, so they are not reported twice.
export const RETIRED_RULES = {
  'process-hygiene.no-ci': 'workflow.no-automated-checks',
  'process-hygiene.direct-commits-to-main': 'workflow.no-branch-per-change',
  'process-hygiene.knowledge-concentration': 'workflow.single-person-dependency',
  'process-hygiene.stale-branches': 'workflow.unclear-branches',
  'architecture.duplicated-markup': 'architecture.no-shared-layout',
};

export const SEVERITIES =['critical', 'high', 'medium', 'low'];
export const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
