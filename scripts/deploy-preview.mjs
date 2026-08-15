#!/usr/bin/env node
// Deploy this repo's tracked source to a Vercel PREVIEW deployment.
//
// The pedroestevez-com project is NOT git-linked — it deploys by direct file
// upload, and Vercel runs the Astro build itself (the live deployment's file
// listing is source, not dist). So we upload tracked source and let Vercel build.
//
// Defaults to a PREVIEW deployment. Publishing to production requires passing
// --production explicitly, so promotion is always a deliberate act and can
// never happen as a side effect of a normal deploy.
//
//   node scripts/deploy-preview.mjs                # preview
//   node scripts/deploy-preview.mjs --production   # publishes pedroestevez.com

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const TOKEN = process.env.VERCEL_TOKEN;
const TEAM = 'team_GEENB7sWSnIXu4w6128Sa4SF';
const PROJECT = 'pedroestevez-com';
const ROOT = path.resolve(import.meta.dirname, '..');

if (!TOKEN) throw new Error('VERCEL_TOKEN not set');

const PRODUCTION = process.argv.includes('--production');

const api = (p) => `https://api.vercel.com${p}${p.includes('?') ? '&' : '?'}teamId=${TEAM}`;
const auth = { Authorization: `Bearer ${TOKEN}` };

// Tracked files only — never node_modules/dist/.astro. Run scratch lives in the
// gitignored .run/ dir, so it is structurally excluded from the upload.
const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

console.log(PRODUCTION ? '*** PUBLISHING TO PRODUCTION — pedroestevez.com ***' : 'Deploying to PREVIEW');
console.log(`Uploading ${tracked.length} tracked files:`);
const files = [];
for (const rel of tracked) {
  const buf = readFileSync(path.join(ROOT, rel));
  const sha = createHash('sha1').update(buf).digest('hex');
  const res = await fetch(api('/v2/files'), {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/octet-stream', 'x-vercel-digest': sha, 'x-vercel-size': String(buf.length) },
    body: buf,
  });
  if (!res.ok) throw new Error(`upload ${rel} failed: ${res.status} ${await res.text()}`);
  files.push({ file: rel, sha, size: buf.length });
  console.log(`  ${rel}  ${buf.length}B`);
}

const res = await fetch(api('/v13/deployments'), {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: PROJECT,
    project: PROJECT,
    // The API accepts only 'production', 'staging', or a custom environment id.
    // Omitting the field entirely is how a PREVIEW deployment is created — so
    // the default path here structurally cannot reach production.
    ...(PRODUCTION ? { target: 'production' } : {}),
    files,
    projectSettings: { framework: 'astro' },
  }),
});
const out = await res.json();
if (!res.ok) throw new Error(`deploy failed: ${res.status} ${JSON.stringify(out).slice(0, 800)}`);

console.log('\nid:     ', out.id);
console.log('target: ', out.target);

let state = out.readyState || out.status;
for (let i = 0; i < 90 && !['READY', 'ERROR', 'CANCELED'].includes(state); i++) {
  await new Promise((r) => setTimeout(r, 4000));
  const s = await fetch(api(`/v13/deployments/${out.id}`), { headers: auth });
  state = (await s.json()).readyState;
  if (i % 4 === 0) console.log(`  ...${state}`);
}
console.log('final state:', state);
console.log(`\nPREVIEW_URL=https://${out.url}`);
if (state !== 'READY') process.exitCode = 1;
