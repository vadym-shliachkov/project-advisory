const ev = (ref, type = 'file') => ({ type, ref });

const F = (id, area, kind, severity, title, verified, status, extra = {}) => ({
  id, rule: `${area}.${id.toLowerCase()}`, subject: 'site', area, kind, title,
  why: `Why ${title.toLowerCase()} matters for the business.`, severity, confidence: 'high',
  evidence: [ev(`${area}/evidence.txt:3`)], verified, status, ...extra,
});

export function sampleDoc() {
  return {
    run: '2026-10-11T0950',
    project: { name: 'Acme Studio', url: 'https://acme.test' },
    mode: 'subagents',
    areas: {
      'ai-setup': { status: 'ok', score: 99 },
      architecture: { status: 'ok', score: 96 },
      workflow: { status: 'ok', score: 100 },
      hosting: { status: 'skipped', reason: 'not selected' },
      seo: { status: 'ok', score: 65 },
      'content-conversion': { status: 'failed', reason: 'no output' },
      'code-quality': { status: 'ok', score: 100 },
      performance: { status: 'ok', score: 96 },
      'process-hygiene': { status: 'ok', score: 100 },
      security: { status: 'ok', score: 75 },
      'privacy-legal': { status: 'ok', score: 100 },
    },
    overallScore: 92,
    findings: [
      F('SEC-a91c', 'security', 'issue', 'critical', 'Secrets committed in .env.production', true, 'new'),
      F('SEO-77de', 'seo', 'issue', 'critical', 'noindex on the production site', true, 'persisting'),
      F('SEO-1b2c', 'seo', 'issue', 'high', 'Pages have no meta description', false, 'persisting', {
        toConfirm: 'Look at the published pages, which this run could not reach.',
      }),
      F('PERF-0b3e', 'performance', 'issue', 'medium', 'Images are not lazy-loaded', false, 'new', { toConfirm: 'Measure page speed on the live site.' }),
      F('AI-4d5e', 'ai-setup', 'issue', 'low', 'AGENTS.md is very long', true, 'new'),
      F('ARCH-5c10', 'architecture', 'issue', 'medium', 'Header and footer are copied into 30 files', true, 'new', {
        direction: 'Shared layouts in a static site generator such as Eleventy or Astro.',
      }),
      F('AI-9e02', 'ai-setup', 'tooling', 'medium', 'Skill: scaffold a page', true, 'new', {
        toolType: 'skill', trigger: 'When a new page is added', draftDescription: 'Creates a page from the shared layout and links it in the navigation.',
        evidence: [ev('a1b2c3d', 'commit'), ev('b2c3d4e', 'commit'), ev('c3d4e5f', 'commit')],
      }),
    ],
    fixed: [{ id: 'HOST-12aa', area: 'hosting', title: 'No HTTPS redirect' }],
    notVerified: ['Lighthouse disabled — performance metrics come from code inspection'],
  };
}

export function sampleProfile() {
  return {
    stacks: ['static-html'],
    siteType: 'brochure',
    brand: { name: 'Acme Studio', logo: null, primaryColor: '#0a7cff', fontFamily: 'Inter', fontUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap' },
  };
}

// A synthesis for the findings ticked by default plus nothing else: SEC-a91c, SEO-77de, SEO-1b2c, ARCH-5c10, AI-9e02.
export function sampleSynthesis() {
  return {
    summary: {
      verdict: 'The site works, but two problems put it at risk now: passwords are stored where anyone with access can read them, and search engines are told to ignore the site.',
      strengths: ['Pages are small and fast to load.'],
    },
    decisions: [{
      id: 'D1',
      title: 'Every page carries its own copy of the header',
      findingIds: ['ARCH-5c10'],
      problem: 'The header and footer are written out in each of the 30 pages, so a menu change means editing 30 files.',
      costs: ['A menu change takes a day instead of minutes.', 'Pages drift apart when one copy is missed.'],
      options: [
        { name: 'Keep the copies, add a check', description: 'A check warns when the copies differ.', pros: ['No change to how pages are built'], cons: ['Still 30 edits per change'], size: 'small', recommended: false },
        { name: 'Shared layouts', description: 'A site generator builds every page from one header and footer.', pros: ['One edit updates every page'], cons: ['The team learns a new tool'], size: 'medium', recommended: true },
      ],
      recommendation: 'Shared layouts remove the cause and suit a site that changes every week.',
    }],
    themes: [{ id: 'T1', title: 'Search engines are kept away', findingIds: ['SEO-77de', 'SEO-1b2c'], summary: 'The site tells search engines not to list it, and pages have no summary text for search results.' }],
    workflow: {
      summary: 'Changes are made on one laptop and uploaded by hand.',
      today: [{ step: 'Edit pages on a laptop' }, { step: 'Upload by hand', weak: true, note: 'Nobody checks the upload' }],
      proposed: [{ step: 'Start the change on its own branch', tool: 'Start each change on its own branch' }, { step: 'Create a page from the template', toolId: 'AI-9e02' }, { step: 'Publish automatically after review' }],
    },
    plan: {
      summary: 'Stop the harm first and check what could not be seen, then share the layout.',
      stages: [
        {
          title: 'Stop the harm and check what we could not see',
          goal: 'These problems cost visitors today or need a look before they can be sized.',
          fixes: [
            {
              id: 'F1', title: 'The passwords are safe again', findingIds: ['SEC-a91c'],
              problem: 'Passwords sit in a file that anyone with access to the project can read.',
              approach: 'The exposed passwords are replaced and kept out of the project from now on.',
              steps: [
                { id: 'F1.1', kind: 'work', title: 'Replace the passwords', what: 'Change every exposed password and move them out of the project. Why: anyone who copied the project can use them.', effort: 'quick', needs: ['Admin access to the hosting account'] },
              ],
              doneWhen: ['No password is stored in the project, and the old ones no longer work.'],
            },
            {
              id: 'F2', title: 'Search engines list the site with good summaries', covers: ['T1'],
              problem: 'Search engines are told to skip the site, and pages have no summary for search results.',
              approach: 'First see which pages lack a summary, then let search engines in and give each page its own summary.',
              steps: [
                { id: 'F2.1', kind: 'check', title: 'Confirm what search results show', what: 'Look at the published pages to see which have no summary for search results.', effort: 'quick', needs: ['Read access to the search console'] },
                { id: 'F2.2', kind: 'work', title: 'Give every page its summary', what: 'Search engines may list every page, and each page has its own summary.', effort: 'after-check', sizeNote: 'Quick if only a few pages lack a summary; small if most do.', after: ['F2.1'] },
              ],
              doneWhen: ['Every page has its own summary, and search engines may list the site.'],
            },
          ],
        },
        {
          title: 'Share one layout',
          goal: 'Every later page change gets cheaper once the header lives in one place.',
          fixes: [
            {
              id: 'F3', title: 'Every page uses one shared header and footer', covers: ['D1'],
              problem: 'Every page carries its own copy of the header, so one change means editing every page.',
              routes: [
                { name: 'Site generator', summary: 'A site generator builds every page from one header and footer.', effort: 'medium', pros: ['New pages come out complete'], cons: ['One more tool to learn'], compare: [{ row: 'Adding a page', value: 'Fill in a short file.' }] },
                { name: 'Shared include', summary: 'The server inserts one shared header and footer into every page.', effort: 'small', pros: ['Nothing new to learn'], cons: ['Pages are still copied by hand'], compare: [{ row: 'Adding a page', value: 'Copy an existing page.' }] },
              ],
              choice: 'Both remove the copied header; the generator suits a team that adds pages often, the include one that rarely does.',
              approach: 'The shared header and footer are agreed first, then one of the two routes puts them on every page, and every page is checked.',
              steps: [
                { id: 'F3.1', kind: 'work', title: 'Agree the shared header and footer', what: 'Settle what the shared header and footer contain. Why: every page will show them.', effort: 'quick', needs: ['Agreement on decision 1'], checklist: [{ point: 'Main menu items', needs: 'The list of pages to show', why: 'Visitors find the main pages from every page.' }] },
                { id: 'F3.2', kind: 'work', title: 'Build the pages with a site generator', what: 'Move every page onto the generator with one header and footer.', effort: 'medium', route: 'Site generator', after: ['F3.1'] },
                { id: 'F3.3', kind: 'work', title: 'Insert the shared parts on the server', what: 'Have the server insert the shared header and footer into every page.', effort: 'small', route: 'Shared include', after: ['F3.1'], needs: ['Admin access to the hosting account'] },
                { id: 'F3.4', kind: 'check', title: 'Check every page', what: 'Open every page on a phone and a desktop and compare it with the live site.', effort: 'small', after: ['F3.2', 'F3.3'] },
              ],
              doneWhen: ['A change to the header shows on every page after one edit.'],
            },
          ],
        },
      ],
    },
    tools: [{ name: 'Start each change on its own branch', type: 'command', problem: 'Changes are made straight on the live copy, so half-done work reaches visitors.', trigger: 'When someone starts a significant change', description: 'Creates a branch named after the task so the live site is untouched until review.', benefit: 'Each change can be checked on its own before anyone sees it.', decision: 'D1' }],
    wording: { 'SEC-a91c': { title: 'Passwords are stored in a file anyone with access can read', why: 'Former contractors could still use them.' } },
    glossary: [{ term: 'site generator', meaning: 'A tool that builds every page from shared parts.' }],
    review: { readable: true, notes: ['Replaced file names with plain descriptions.'] },
  };
}
