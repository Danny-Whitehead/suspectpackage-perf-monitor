import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const csvPath = path.join(root, 'docs', 'data', 'crux.csv');
const HEADER = 'date,url,device,level,lcp,inp,cls,fcp,ttfb';
const apiKey = process.env.CRUX_API_KEY;

if (!apiKey) {
  console.log('CRUX_API_KEY not set, skipping field data.');
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
const existing = fs.existsSync(csvPath) ? fs.readFileSync(csvPath, 'utf8') : '';
const formFactors = { mobile: 'PHONE', desktop: 'DESKTOP' };
const endpoint = `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${apiKey}`;

async function query(target, formFactor) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...target, formFactor }),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`CrUX API ${response.status}: ${await response.text()}`);
  return (await response.json()).record.metrics;
}

const p75 = (metrics, name) => {
  const value = metrics?.[name]?.percentiles?.p75;
  return value === undefined ? '' : Number(value);
};

const rows = [];
for (const device of config.devices) {
  for (const url of config.urls) {
    // One snapshot per URL per day: CrUX is a rolling 28-day figure that updates daily.
    if (existing.includes(`${today},${url},${device},`)) continue;
    try {
      let level = 'url';
      let metrics = await query({ url }, formFactors[device]);
      if (!metrics) {
        level = 'origin';
        metrics = await query({ origin: new URL(url).origin }, formFactors[device]);
      }
      if (!metrics) continue;
      rows.push([
        today, url, device, level,
        p75(metrics, 'largest_contentful_paint'),
        p75(metrics, 'interaction_to_next_paint'),
        p75(metrics, 'cumulative_layout_shift'),
        p75(metrics, 'first_contentful_paint'),
        p75(metrics, 'experimental_time_to_first_byte'),
      ].join(','));
    } catch (error) {
      console.error(`CrUX failed for ${url}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

if (rows.length) {
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  fs.appendFileSync(csvPath, (existing ? '' : HEADER + '\n') + rows.join('\n') + '\n');
}
console.log(`CrUX: added ${rows.length} row(s).`);
