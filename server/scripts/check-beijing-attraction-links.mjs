import { readFile } from 'node:fs/promises';

const attractionSource = await readFile(new URL('../src/db/beijing-attractions.ts', import.meta.url), 'utf8');
const hoursSource = await readFile(new URL('../src/db/beijing-attraction-hours.ts', import.meta.url), 'utf8');
const attractionIds = [...attractionSource.matchAll(/\bid:\s*'([^']+)'/g)].map((match) => match[1]);
const metadataIds = [...hoursSource.matchAll(/^\s*'([^']+)':\s*\{/gm)].map((match) => match[1]);
const urlPattern = /https:\/\/[^\s'"),]+/g;
const urls = [...new Set([...attractionSource.match(urlPattern) || [], ...hoursSource.match(urlPattern) || []])];
const metadataMissing = attractionIds.filter((id) => !metadataIds.includes(id));
const metadataOrphans = metadataIds.filter((id) => !attractionIds.includes(id));
const checks = [];
let cursor = 0;

async function checkUrl(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const response = await fetch(url, {
        method,
        redirect: 'follow',
        signal: AbortSignal.timeout(9000),
        headers: method === 'GET' ? { Range: 'bytes=0-0' } : undefined,
      });
      if (response.status >= 200 && response.status < 400) {
        checks.push({ url, status: 'OK', detail: `${response.status} ${response.url}` });
        return;
      }
      if ([404, 410].includes(response.status)) {
        checks.push({ url, status: 'BROKEN', detail: `HTTP ${response.status}` });
        return;
      }
      if (method === 'GET' || ![403, 405, 429].includes(response.status)) {
        checks.push({ url, status: 'REVIEW', detail: `HTTP ${response.status}; verify manually` });
        return;
      }
    } catch (error) {
      checks.push({ url, status: 'REVIEW', detail: error instanceof Error ? error.message : 'request failed' });
      return;
    }
  }
}

await Promise.all(Array.from({ length: Math.min(4, urls.length) }, async () => {
  while (cursor < urls.length) await checkUrl(urls[cursor++]);
}));

for (const result of checks.sort((a, b) => a.status.localeCompare(b.status) || a.url.localeCompare(b.url))) {
  console.log(`[${result.status}] ${result.url} — ${result.detail}`);
}
if (metadataMissing.length) console.error(`Missing hours/reservation metadata: ${metadataMissing.join(', ')}`);
if (metadataOrphans.length) console.error(`Metadata without an attraction: ${metadataOrphans.join(', ')}`);
console.log(`\nChecked ${urls.length} unique URLs for ${attractionIds.length} Beijing attractions.`);
console.log('REVIEW results need a manual browser check; official sites may block automated probes.');
if (checks.some((result) => result.status === 'BROKEN') || metadataMissing.length || metadataOrphans.length) process.exitCode = 1;
