const tagsOf = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) ?? [];
const stripTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

function metaContent(metas, key) {
  const tag = metas.find((m) => (attr(m, 'name') ?? attr(m, 'property') ?? '').toLowerCase() === key);
  return tag ? attr(tag, 'content') : null;
}

export function extractMeta(html) {
  const text = String(html);
  const metas = tagsOf(text, 'meta');
  const linkTags = tagsOf(text, 'link');
  const imgs = tagsOf(text, 'img');
  const canonical = linkTags.find((l) => /\srel\s*=\s*["']?canonical/i.test(l));
  const logoTag = imgs.find((t) => /logo/i.test(`${attr(t, 'class') ?? ''} ${attr(t, 'src') ?? ''} ${attr(t, 'alt') ?? ''} ${attr(t, 'id') ?? ''}`));
  return {
    title: /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]?.trim() ?? null,
    metaDescription: metaContent(metas, 'description'),
    robots: metaContent(metas, 'robots'),
    generator: metaContent(metas, 'generator'),
    themeColor: metaContent(metas, 'theme-color'),
    ogTitle: metaContent(metas, 'og:title'),
    ogImage: metaContent(metas, 'og:image'),
    siteName: metaContent(metas, 'og:site_name'),
    canonical: canonical ? attr(canonical, 'href') : null,
    lang: attr(tagsOf(text, 'html')[0] ?? '', 'lang'),
    h1Count: (text.match(/<h1\b/gi) ?? []).length,
    ldJsonCount: (text.match(/<script[^>]+application\/ld\+json/gi) ?? []).length,
    imgCount: imgs.length,
    imgMissingAlt: imgs.filter((t) => attr(t, 'alt') === null).length,
    scripts: tagsOf(text, 'script').map((t) => attr(t, 'src')).filter(Boolean),
    stylesheets: linkTags.filter((l) => /\srel\s*=\s*["']?stylesheet/i.test(l)).map((l) => attr(l, 'href')).filter(Boolean),
    images: imgs.map((t) => attr(t, 'src')).filter(Boolean),
    logo: logoTag ? attr(logoTag, 'src') : null,
    links: [...text.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].slice(0, 300)
      .map((m) => ({ href: attr(` ${m[1]}`, 'href'), text: stripTags(m[2]).slice(0, 80) }))
      .filter((l) => l.href),
  };
}
