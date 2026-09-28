#!/usr/bin/env bun
import { readdir, readFile, stat, access } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARTIFACT_WORDS, CASE_SENSITIVE_ARTIFACT_WORDS, createBuildConfig, resolveSeed } from '../srv/vite/build-config';

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
const problems: string[] = [];

async function exists(p: string) { try { await access(p); return true; } catch { return false; } }

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

function contains(text: string, needle: string, caseSensitive: boolean): boolean {
  return caseSensitive ? text.includes(needle) : text.toLowerCase().includes(needle.toLowerCase());
}

const SHELL_TELLS = ['id="app-shell"', 'id="stage"', 'id="toolbar"', 'id="browser-container"'];
const SHELL_GA_TELLS = ['gtag', 'googletagmanager', 'dataLayer', 'G-BMERY'];
const COVER_TITLES = new Set(['Workspace', 'Console', 'Portal', 'Dashboard', 'Projects']);
const BRANDED_CHUNK_TAILS = ['-scramjet', '-wisp', '-epoxy', '-libcurl', '-scram', '-mercuryworkshop', '-ultraviolet'];

// 1 + 2 — vocabulary + shell tells
for (const path of await walk(distDir)) {
  const rel = relative(distDir, path);
  const s = await stat(path);
  if (s.size > 20_000_000) continue;
  const buf = await readFile(path);

  // Filename vocab
  for (const word of ARTIFACT_WORDS) {
    const cs = CASE_SENSITIVE_ARTIFACT_WORDS.has(word);
    if (!cs && rel.toLowerCase().includes(word)) problems.push(`vocab-filename: ${rel} contains ${word}`);
  }

  const isText = /\.(?:js|mjs|css|html|json|map|txt|svg)$/.test(rel);
  if (isText) {
    const text = buf.toString('utf8');
    for (const word of ARTIFACT_WORDS) {
      const cs = CASE_SENSITIVE_ARTIFACT_WORDS.has(word);
      if (contains(text, word, cs)) problems.push(`vocab-content: ${rel} contains ${word}`);
    }
    if (rel.endsWith('.html') || rel.endsWith('.js')) {
      for (const t of SHELL_TELLS) {
        if (text.includes(t)) problems.push(`shell-tell: ${rel} contains ${t}`);
      }
    }
  }
}

// 3 — shell has no GA
const shellPath = join(distDir, 'app', 'index.html');
if (await exists(shellPath)) {
  const shell = await readFile(shellPath, 'utf8');
  for (const t of SHELL_GA_TELLS) {
    if (shell.includes(t)) problems.push(`shell-ga: app/index.html contains ${t}`);
  }
} else {
  problems.push('missing: dist/app/index.html');
}

// 4 — landing has GA
const landingPath = join(distDir, 'landing.html');
if (await exists(landingPath)) {
  const landing = await readFile(landingPath, 'utf8');
  const hasGa = SHELL_GA_TELLS.some(t => landing.includes(t));
  if (!hasGa) problems.push('landing-missing-ga: landing.html has no analytics markers');
} else {
  problems.push('missing: dist/landing.html');
}

// 5 — build-seed and build-id
for (const marker of ['.build-seed', '.build-id']) {
  if (!(await exists(join(distDir, marker)))) problems.push(`missing: dist/${marker}`);
}

// 6 — cover identity consistency
const seed = (await readFile(join(distDir, '.build-seed'), 'utf8').catch(() => '')).trim();
const buildId = (await readFile(join(distDir, '.build-id'), 'utf8').catch(() => '')).trim();
const config = seed ? createBuildConfig(seed) : null;

if (config) {
  const shellTitleMatch = (await readFile(shellPath, 'utf8').catch(() => '')).match(/<title>([^<]*)<\/title>/);
  const landingTitleMatch = (await readFile(landingPath, 'utf8').catch(() => '')).match(/<title>([^<]*)<\/title>/);
  const shellTitle = shellTitleMatch?.[1];
  const landingTitle = landingTitleMatch?.[1];
  if (shellTitle !== config.cover.identity.title) {
    problems.push(`cover-shell-title: shell title "${shellTitle}" != expected "${config.cover.identity.title}"`);
  }
  if (landingTitle !== config.cover.identity.title) {
    problems.push(`cover-landing-title: landing title "${landingTitle}" != expected "${config.cover.identity.title}"`);
  }
  if (shellTitle && !COVER_TITLES.has(shellTitle)) {
    problems.push(`cover-unknown-title: shell title "${shellTitle}" not in cover set`);
  }
  // 7 — SW file
  if (!(await exists(join(distDir, config.cover.worker)))) {
    problems.push(`missing-sw: expected dist/${config.cover.worker}`);
  }
  // 8 — build registry
  const registryPath = join(distDir, 'runtime', '.builds.json');
  if (!(await exists(registryPath))) {
    problems.push('missing: dist/runtime/.builds.json');
  } else {
    try {
      const registry = JSON.parse(await readFile(registryPath, 'utf8'));
      if (!Array.isArray(registry) || registry.length === 0) {
        problems.push('registry-empty: dist/runtime/.builds.json has no entries');
      } else {
        const latest = registry[registry.length - 1];
        if (latest.buildId !== buildId) {
          problems.push(`registry-mismatch: latest buildId "${latest.buildId}" != dist/.build-id "${buildId}"`);
        }
      }
    } catch {
      problems.push('registry-corrupt: dist/runtime/.builds.json is not valid JSON');
    }
  }
}

// 9 — chunk names not branded compounds
const chunksDir = join(distDir, 'chunks');
if (await exists(chunksDir)) {
  for (const name of await readdir(chunksDir)) {
    for (const tail of BRANDED_CHUNK_TAILS) {
      if (name.toLowerCase().includes(tail)) {
        problems.push(`branded-chunk: chunks/${name} contains ${tail}`);
      }
    }
  }
}

if (problems.length) {
  console.error(`\n✖ FAIL (${problems.length} issue${problems.length === 1 ? '' : 's'}):\n`);
  for (const p of problems.slice(0, 40)) console.error('  -', p);
  if (problems.length > 40) console.error(`  ... and ${problems.length - 40} more`);
  process.exit(1);
}

const totalFiles = (await walk(distDir)).length;
console.log(`\n✔ PASS: verified ${totalFiles} files clean.\n`);
console.log(`  Build ID:   ${buildId}`);
console.log(`  Seed:       ${seed.slice(0, 12)}…`);
console.log(`  Cover:      ${config?.cover.provider} → ${config?.cover.identity.title}`);
console.log(`  SW file:    ${config?.cover.worker}`);
