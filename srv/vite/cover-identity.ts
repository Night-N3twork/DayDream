import type { Plugin } from 'vite';
import type { BuildConfig } from './build-config';

// Rewrites branding + strips analytics from every emitted HTML file.
//
// The GA-stripping regex uses a tempered-greedy token — `(?:(?!<\/script>)[\s\S])*?`
// — so the `[\s\S]` class cannot swallow an intervening `</script>` on its way
// to `googletagmanager`. Without this, a naive `<script[\s\S]*?googletagmanager`
// pattern matches from the FIRST `<script>` in the file (the `__ddxBase` IIFE),
// crosses every intermediate `</script>` boundary, and destroys every legitimate
// loader script between that opening tag and the GA closing tag.
export function coverIdentityPlugin(config: BuildConfig): Plugin {
  const { identity } = config.cover;
  return {
    name: 'ddx-cover-identity',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        // Only the outer app-shell tab should read as the cover product; the
        // internal app pages (newtab, settings, history, …) render inside the
        // app's own tab-strip, whose label is driven by each page's <title>.
        // Rewriting those would show e.g. "Portal" for the new tab — so scope
        // the <title> replacement to the shell entry (anything NOT under
        // src/pages/). All other rewrites (meta/keywords/og/GA-strip/DDX) still
        // apply to every emitted HTML.
        const file = (ctx?.filename ?? '').replace(/\\/g, '/');
        const isInternalPage = file.includes('/src/pages/');
        if (!isInternalPage) {
          html = html.replace(
            /<title>[\s\S]*?<\/title>/,
            `<title>${identity.title}</title>`,
          );
        }
        return html
          .replace(
            /<meta name="description" content="[^"]*"\s*\/?>/,
            `<meta name="description" content="${identity.description}" />`,
          )
          .replace(
            /<meta\s+name="keywords"[\s\S]*?\/?>/,
            `<meta name="keywords" content="${identity.product}, ${identity.title}" />`,
          )
          .replace(
            /<meta property="og:image"[^>]*>/,
            '<meta property="og:image" content="./res/logo.png" />',
          )
          // Strip the analytics block wholesale in production. Task 22 restores
          // it on the landing page only. Tempered-greedy tokens keep the match
          // scoped to a single <script>…</script> pair.
          .replace(
            /<script\b[^>]*>(?:(?!<\/script>)[\s\S])*?googletagmanager(?:(?!<\/script>)[\s\S])*?<\/script>\s*/g,
            '',
          )
          // Also drop the two GA preconnect hints so nothing points at Google.
          .replace(
            /<link\s+rel="preconnect"\s+href="https:\/\/www\.googletagmanager\.com"[^>]*>\s*/g,
            '',
          )
          .replace(
            /<link\s+rel="preconnect"\s+href="https:\/\/www\.google-analytics\.com"[^>]*>\s*/g,
            '',
          )
          // Replace bare "DDX" tokens in body/label text with the cover product
          // name. Case-sensitive and word-bounded so lowercase class/id tokens
          // like `ddx-status-card` remain untouched. The `<title>` / `<meta>`
          // replacements above already handled the head; anything that reaches
          // this pass is human-readable body content.
          .replace(/\bDDX\b/g, identity.product);
      },
    },
  };
}
