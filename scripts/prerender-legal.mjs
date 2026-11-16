// Usage: node scripts/prerender-legal.mjs (after vite build). Writes dist/<page>/index.html.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const out = 'node_modules/.cache/prerender-legal.mjs';
await build({ entryPoints: ['scripts/prerender-legal.entry.tsx'], bundle: true, platform: 'node', format: 'esm', outfile: out, jsx: 'automatic', logLevel: 'error', external: ['react', 'react-dom', 'react-router'] });
const { rendered } = await import(pathToFileURL(out).href);
rmSync(out);

const base = (process.env.VITE_BASE_PATH || '/').replace(/\/?$/, '/');
const template = readFileSync('dist/index.html', 'utf8');
const titles = { privacy: 'Privacy Policy', terms: 'Terms of Service', 'data-deletion': 'Delete your data' };
for (const [path, html] of Object.entries(rendered)) {
  // Links rendered for "/" must point under the site's base path.
  const body = html.replace(/href="\/(?!\/)/g, `href="${base}`);
  const page = template
    .replace(/<title>[^<]*<\/title>/, `<title>${titles[path]} | XS Connect</title>`)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`);
  if (!page.includes(body)) throw new Error('index.html has no empty root element');
  mkdirSync(`dist/${path}`, { recursive: true });
  writeFileSync(`dist/${path}/index.html`, page);
}
console.log('prerendered:', Object.keys(rendered).join(', '));
