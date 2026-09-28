import type { Plugin, ResolvedConfig } from "vite";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

export function svgWrapperPlugin(subdir = ""): Plugin {
  let config: ResolvedConfig;

  return {
    name: "ddx-svg-wrapper",
    apply: "build",
    enforce: "post",

    configResolved(c) {
      config = c;
    },

    closeBundle() {
      // `subdir` lets the svg be generated next to the app shell (e.g. "app"),
      // so its relative ./assets refs resolve under /app/ and it boots the app
      // directly when opened as /app/index.svg — no redirect needed.
      const outDir = resolve(config.root, config.build.outDir, subdir);
      const indexPath = resolve(outDir, "index.html");
      // closeBundle still fires when an upstream build error prevented the
      // HTML from being emitted. Silently skip in that case so the real
      // error isn't buried under a misleading ENOENT.
      if (!existsSync(indexPath)) return;
      try {
        const html = readFileSync(indexPath, "utf-8");
        const svg = convertHtmlToSvg(html);
        writeFileSync(resolve(outDir, "index.svg"), svg, "utf-8");
        console.log(
          `\x1b[36m  Generated ${subdir ? subdir + "/" : ""}index.svg from index.html\x1b[0m`,
        );
      } catch (err) {
        console.error("\x1b[31m  Failed to generate index.svg:\x1b[0m", err);
      }
    },
  };
}

/**
 * Build a tiny SVG document that immediately redirects to `target` when opened
 * as a top-level page. Used to emit a root `/index.svg` that forwards to the
 * real bootloader at `/app/index.svg`. The target is relative so it resolves
 * correctly regardless of the mount point (from `/index.svg`, `app/index.svg`
 * resolves to `/app/index.svg`). A `<noscript>`-style anchor fallback is not
 * possible in bare SVG, so we also set a `<a xlink:href>` cover for the
 * scriptless case.
 */
export function buildRedirectSvg(target: string): string {
  const safe = target.replace(/"/g, "&quot;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100%" height="100%" style="position: fixed; top: 0; left: 0;">
  <script type="text/javascript"><![CDATA[
    window.location.replace("${target}");
  ]]></script>
  <a xlink:href="${safe}">
    <text x="12" y="24" font-family="sans-serif" font-size="14">Redirecting…</text>
  </a>
</svg>`;
}

/**
 * Emit a redirect SVG at `<outDir>/<fileName>` that forwards to `target`.
 * Registered after the app-shell svg so a root `/index.svg` forwards to the
 * co-located `/app/index.svg` bootloader.
 */
export function svgRedirectPlugin(
  fileName: string,
  target: string,
): Plugin {
  let config: ResolvedConfig;
  return {
    name: "ddx-svg-redirect",
    apply: "build",
    enforce: "post",
    configResolved(c) {
      config = c;
    },
    closeBundle() {
      const outDir = resolve(config.root, config.build.outDir);
      try {
        writeFileSync(
          resolve(outDir, fileName),
          buildRedirectSvg(target),
          "utf-8",
        );
        console.log(
          `\x1b[36m  Generated ${fileName} redirect -> ${target}\x1b[0m`,
        );
      } catch (err) {
        console.error(
          `\x1b[31m  Failed to generate ${fileName} redirect:\x1b[0m`,
          err,
        );
      }
    },
  };
}

interface ScriptEntry {
  type: "inline" | "external";
  content?: string;
  src?: string;
  isModule?: boolean;
  hasDefer?: boolean;
  hasCrossorigin?: boolean;
}

interface ParsedHtml {
  inlineStyles: string[];
  headTags: string[];
  bodyAttrs: string;
  bodyInner: string;
  scripts: ScriptEntry[];
}

function parseHtml(html: string): ParsedHtml {
  let src = html
    .replace(/<!doctype\s+html>/i, "")
    .replace(/<html[^>]*>/i, "")
    .replace(/<\/html\s*>/i, "")
    .trim();

  const inlineStyles: string[] = [];
  const headTags: string[] = [];
  const scripts: ScriptEntry[] = [];

  const bodyMatch = src.match(/<body(\s[^>]*)?>/i);
  let headPart = src;
  let bodyAttrs = "";
  let bodyInner = "";

  if (bodyMatch && bodyMatch.index !== undefined) {
    headPart = src.slice(0, bodyMatch.index);
    bodyAttrs = (bodyMatch[1] || "").trim();
    const afterBody = src.slice(bodyMatch.index + bodyMatch[0].length);
    bodyInner = afterBody.replace(/<\/body\s*>/i, "").trim();
  }

  headPart = headPart.replace(
    /<style(?:\s[^>]*)?>([^]*?)<\/style>/gi,
    (_, content) => {
      inlineStyles.push(content);
      return "";
    },
  );

  headPart = headPart.replace(
    /<script(\s[^>]*)?>([^]*?)<\/script>/gi,
    (full, attrs, content) => {
      scripts.push(parseScriptTag(attrs || "", content));
      return "";
    },
  );

  bodyInner = bodyInner.replace(
    /<script(\s[^>]*)?>([^]*?)<\/script>/gi,
    (full, attrs, content) => {
      scripts.push(parseScriptTag(attrs || "", content));
      return "";
    },
  );

  const tagRe = /<([\w-]+)(\s[^>]*)?\/?>/g;
  let match: RegExpExecArray | null;
  const seen = new Set<number>();

  while ((match = tagRe.exec(headPart)) !== null) {
    const tag = match[0];
    const tagName = match[1].toLowerCase();
    if (seen.has(match.index)) continue;
    seen.add(match.index);

    if (tagName === "title") {
      const titleClose = headPart.indexOf("</title>", match.index);
      if (titleClose !== -1) {
        headTags.push(headPart.slice(match.index, titleClose + 8));
      }
    } else {
      headTags.push(tag);
    }
  }

  return { inlineStyles, headTags, bodyAttrs, bodyInner, scripts };
}

function parseScriptTag(attrs: string, content: string): ScriptEntry {
  const srcMatch = attrs.match(/\bsrc=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const isModule =
    /\btype=module\b/i.test(attrs) || /\btype="module"/i.test(attrs);
  const hasDefer = /\bdefer\b/i.test(attrs);
  const hasCrossorigin = /\bcrossorigin\b/i.test(attrs);

  if (srcMatch) {
    const src = srcMatch[1] || srcMatch[2] || srcMatch[3];
    return {
      type: "external",
      src,
      isModule,
      hasDefer,
      hasCrossorigin,
    };
  }

  return { type: "inline", content: content.trim() };
}

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function toXhtml(html: string): string {
  return html.replace(
    /<([\w-]+)((?:\s[^>]*?)?)\s*(\/?)\s*>/gi,
    (full, tagName: string, attrsRaw: string, selfClose: string) => {
      const tag = tagName.toLowerCase();

      const attrs = fixAttributes(attrsRaw || "");

      if (VOID_ELEMENTS.has(tag)) {
        return `<${tagName}${attrs} />`;
      }

      return `<${tagName}${attrs}${selfClose ? " /" : ""}>`;
    },
  );
}

function fixAttributes(raw: string): string {
  if (!raw) return "";

  const result: string[] = [];
  let i = 0;

  while (i < raw.length) {
    if (/\s/.test(raw[i])) {
      result.push(raw[i]);
      i++;
      continue;
    }

    const nameStart = i;
    while (i < raw.length && /[\w:.-]/.test(raw[i])) i++;
    const name = raw.slice(nameStart, i);

    if (!name) {
      result.push(raw[i] || "");
      i++;
      continue;
    }

    if (i < raw.length && raw[i] === "=") {
      i++;

      if (i < raw.length && raw[i] === '"') {
        const end = raw.indexOf('"', i + 1);
        if (end !== -1) {
          result.push(`${name}=${raw.slice(i, end + 1)}`);
          i = end + 1;
        } else {
          result.push(`${name}=${raw.slice(i)}`);
          i = raw.length;
        }
      } else if (i < raw.length && raw[i] === "'") {
        const end = raw.indexOf("'", i + 1);
        if (end !== -1) {
          const val = raw.slice(i + 1, end);
          result.push(`${name}="${val}"`);
          i = end + 1;
        } else {
          result.push(`${name}="${raw.slice(i + 1)}"`);
          i = raw.length;
        }
      } else {
        const valStart = i;
        while (i < raw.length && !/[\s>]/.test(raw[i])) i++;
        const val = raw.slice(valStart, i);
        result.push(`${name}="${val}"`);
      }
    } else {
      result.push(`${name}=""`);
    }
  }

  return result.join("");
}

function escapeCdata(code: string): string {
  return code.replace(/\]\]>/g, "]]]]><![CDATA[>");
}

function buildScriptSection(scripts: ScriptEntry[]): string {
  const parts: string[] = [];

  parts.push(
    [
      "(function() {",
      '  var ns = "http://www.w3.org/1999/xhtml";',
      '  var body = document.querySelector("body");',
      '  var head = document.createElementNS(ns, "head");',
      "  body.prepend(head);",
      '  Object.defineProperty(document, "head", { get: function() { return head; }, configurable: true });',
      '  Object.defineProperty(document, "body", { get: function() { return body; }, configurable: true });',
      "  var origCreate = document.createElement.bind(document);",
      "  document.createElement = function(tag, opts) {",
      "    return document.createElementNS(ns, tag, opts);",
      "  };",
      "  // SVG is an XML document: document.write() throws InvalidStateError.",
      "  // The app's base-shim uses it only to inject a <base>; the app's assets",
      "  // resolve relative to this .svg's own URL and self.__ddxBase comes from",
      "  // the shim's return value, so a safe no-op is sufficient and prevents",
      "  // the bootstrap from aborting.",
      "  document.write = document.writeln = function () {};",
      "})();",
    ].join("\n"),
  );

  for (const s of scripts) {
    if (s.type === "inline" && s.content) {
      parts.push(s.content);
    }
  }

  const externals = scripts.filter((s) => s.type === "external" && s.src);
  if (externals.length > 0) {
    const nonModule = externals.filter((s) => !s.isModule);
    const modules = externals.filter((s) => s.isModule);

    const loaderLines: string[] = [];
    loaderLines.push(
      "(function() {",
      '  var ns = "http://www.w3.org/1999/xhtml";',
      "  var d = document;",
      '  var b = d.querySelector("body");',
      "",
      "  function loadModules() {",
    );

    if (modules.length > 0) {
      loaderLines.push(
        "    var mods = " +
          JSON.stringify(
            modules.map((s) => ({
              src: s.src,
              co: s.hasCrossorigin || false,
            })),
          ) +
          ";",
        "    mods.forEach(function(m, i) {",
        '      var s = d.createElementNS(ns, "script");',
        '      s.setAttribute("type", "module");',
        '      s.setAttribute("src", m.src);',
        '      if (m.co) s.setAttribute("crossorigin", "");',
        "      if (i === mods.length - 1) {",
        '        s.onload = function() { d.dispatchEvent(new Event("DOMContentLoaded")); };',
        "      }",
        "      b.appendChild(s);",
        "    });",
      );
    }

    loaderLines.push("  }", "");

    if (nonModule.length > 0) {
      loaderLines.push(
        "  // Load non-module deps first, then modules after all finish",
        "  var srcs = " + JSON.stringify(nonModule.map((s) => s.src)) + ";",
        "  var pending = srcs.length;",
        "  function done() { if (--pending === 0) loadModules(); }",
        "  srcs.forEach(function(u) {",
        '    var s = d.createElementNS(ns, "script");',
        '    s.setAttribute("src", u);',
        "    s.async = false;",
        "    s.onload = done;",
        "    s.onerror = done;",
        "    b.appendChild(s);",
        "  });",
      );
    } else {
      loaderLines.push("  loadModules();");
    }

    loaderLines.push("})();");
    parts.push(loaderLines.join("\n"));
  }

  return escapeCdata(parts.join(";\n\n"));
}

export function convertHtmlToSvg(html: string): string {  const parsed = parseHtml(html);

  const styleContent = parsed.inlineStyles.join("\n");

  const headXhtml = parsed.headTags.map((t) => toXhtml(t)).join("\n      ");
  const bodyXhtml = toXhtml(parsed.bodyInner);
  const bodyAttrsXhtml = parsed.bodyAttrs
    ? " " +
      toXhtml("<x " + parsed.bodyAttrs + ">")
        .slice(3, -1)
        .trimEnd()
    : "";

  const scriptContent = buildScriptSection(parsed.scripts);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" style="position: fixed; top: 0; left: 0;">
  <style>${styleContent}</style>
  <foreignObject x="0" y="0" width="100%" height="100%">
    <body xmlns="http://www.w3.org/1999/xhtml"${bodyAttrsXhtml}>
      ${headXhtml}
      ${bodyXhtml}
    </body>
  </foreignObject>
  <script><![CDATA[
${scriptContent}
  ]]></script>
</svg>`;
}
