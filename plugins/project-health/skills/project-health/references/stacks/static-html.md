# Stack pack: static HTML

Plain HTML, CSS and JavaScript files without a framework or build step.

## Where to look

- Pages: every `*.html` file. Shared parts (header, footer, navigation) are usually copied between files.
- Styles and scripts: `css/`, `js/`, `assets/`. Check whether they are minified.
- Deploy: often FTP or a drag-and-drop host. Look for `netlify.toml`, `vercel.json`, `.htaccess` or `CNAME` (GitHub Pages).

## Area notes

- architecture: count how many files repeat the same header, footer or navigation markup (`architecture.no-shared-layout`), whether content is edited directly in markup (`architecture.hand-edited-content`), whether case studies, posts and other page types are each hand-built (`architecture.no-content-model`), and whether styles come from one documented set of tokens and components (`architecture.no-design-system`).
- seo: titles, descriptions and canonicals must be set by hand in every file; there is no generated sitemap (`seo.missing-sitemap`). Links between files break easily (`seo.broken-internal-links`).
- performance: without a build step, assets are usually unminified (`performance.unminified-assets`) and images unoptimised (`performance.oversized-images`).
- code-quality: inline `<script>` and `<style>` blocks (`code-quality.inline-styles-scripts`) and the same JavaScript copied between pages (`code-quality.duplicated-code`).
- workflow: there is usually no automatic check before a change goes live (`workflow.no-automated-checks`) and files are uploaded by hand (`workflow.manual-release`).
