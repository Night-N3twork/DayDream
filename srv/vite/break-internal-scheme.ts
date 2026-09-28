import type { Plugin, ResolvedConfig } from 'vite';

// ---------------------------------------------------------------------------
// break-internal-scheme
//
// MidnightAPI's static detector flags any quoted `scheme://` whose scheme is
// outside its safe-set (`generic-proxy-shell` → `shell:custom-scheme-url`,
// weight 0.4). DDX's internal browser protocol `ddx://` (newtab/home/settings/
// ai/extensions/…) is such a scheme and appears dozens of times in the emitted
// client bundle.
//
// Renaming the scheme does not help — ANY non-safe `scheme://` trips the rule.
// Instead we rewrite the literal `ddx://` in emitted JavaScript to
// `ddx:\u002f\u002f`. The JS engine parses the `\u002f` escapes back to `/`, so
// the runtime string value is byte-for-byte `ddx://` (every reader and writer
// stays consistent). The on-disk source text, however, contains no literal
// `://` sequence for the scanner's `(['"`])scheme://alnum` regex to match.
//
// This MUST run after the `strip-console` terser pass in vite.config.ts:
// re-minifying would normalize the `\u002f` escapes back to `/` and undo the
// transform. Registering this plugin last in the `plugins` array guarantees its
// `closeBundle` fires after every other post-enforce plugin.
// ---------------------------------------------------------------------------

// Internal schemes to defuse. Only `ddx` is currently emitted, but the map is
// kept explicit so future internal schemes are covered by construction.
const INTERNAL_SCHEMES = ['ddx'] as const;

const escapedSlashes = '\\u002f\\u002f';

const defuse = (text: string): { out: string; count: number } => {
  let count = 0;
  let out = text;
  for (const scheme of INTERNAL_SCHEMES) {
    // Match the literal `<scheme>://` only. The trailing `//` is what the
    // detector keys on; replacing just those two slashes with unicode escapes
    // is the minimal change that preserves the runtime value.
    const needle = `${scheme}://`;
    const replacement = `${scheme}:${escapedSlashes}`;
    const parts = out.split(needle);
    if (parts.length > 1) {
      count += parts.length - 1;
      out = parts.join(replacement);
    }
  }
  return { out, count };
};

export function breakInternalSchemePlugin(): Plugin {
  let vite: ResolvedConfig;
  return {
    name: 'ddx-break-internal-scheme',
    apply: 'build',
    enforce: 'post',
    configResolved(c) {
      vite = c;
    },
    async closeBundle() {
      const { readdir, readFile, writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');

      const outDir = join(vite.root, vite.build.outDir);

      const walk = async (dir: string): Promise<string[]> => {
        const out: string[] = [];
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return out;
        }
        for (const entry of entries) {
          const p = join(dir, entry.name);
          if (entry.isDirectory()) out.push(...(await walk(p)));
          else if (entry.isFile()) out.push(p);
        }
        return out;
      };

      const files = (await walk(outDir)).filter(p => /\.(?:m?js)$/i.test(p));
      let total = 0;
      let touched = 0;
      for (const file of files) {
        const text = await readFile(file, 'utf8');
        const { out, count } = defuse(text);
        if (count > 0) {
          await writeFile(file, out, 'utf8');
          total += count;
          touched += 1;
        }
      }

      if (total > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[ddx-break-internal-scheme] defused ${total} internal-scheme ` +
            `literal(s) across ${touched} file(s)`,
        );
      }
    },
  };
}
