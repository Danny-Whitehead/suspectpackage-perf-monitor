import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const csvPath = path.join(root, 'docs', 'data', 'lighthouse.csv');
const HEADER = 'timestamp,slot,url,device,runs,score,lcp,cls,tbt,fcp,ttfb,si';

// Optional overrides for manual runs, e.g. ONLY_URL=https://example.com/ RUNS=1 LIMIT_URLS=2
const urls = process.env.ONLY_URL
  ? [process.env.ONLY_URL.trim()]
  : config.urls.slice(0, Number(process.env.LIMIT_URLS) || config.urls.length);
const runsPerUrl = Number(process.env.RUNS) || config.runsPerUrl;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Scheduled runs can start late, so map the start time to the nearest configured slot.
function resolveSlot(now) {
  if (process.env.GITHUB_EVENT_NAME !== 'schedule') return 'manual';
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  let best = null;
  for (const slot of config.slotsUtc) {
    const [h, m] = slot.split(':').map(Number);
    const diff = Math.abs(minutes - (h * 60 + m));
    const distance = Math.min(diff, 1440 - diff);
    if (!best || distance < best.distance) best = { slot, distance };
  }
  return best.slot;
}

async function warmUp(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(30000) });
  } catch {
    // The Lighthouse run reports any real failure.
  }
}

async function singleRun(url, device) {
  const chrome = await launch({ chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'] });
  try {
    const flags = { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance'] };
    const result = await lighthouse(url, flags, device === 'desktop' ? desktopConfig : undefined);
    const lhr = result.lhr;
    if (lhr.runtimeError) throw new Error(`${lhr.runtimeError.code}: ${lhr.runtimeError.message}`);
    const audit = (id) => lhr.audits[id]?.numericValue;
    const final = new URL(lhr.finalDisplayedUrl);
    const requested = new URL(url);
    if (final.pathname.replace(/\/$/, '') !== requested.pathname.replace(/\/$/, '')) {
      console.warn(`  note: ${url} ended up at ${lhr.finalDisplayedUrl}`);
    }
    return {
      score: lhr.categories.performance.score * 100,
      lcp: audit('largest-contentful-paint'),
      cls: audit('cumulative-layout-shift'),
      tbt: audit('total-blocking-time'),
      fcp: audit('first-contentful-paint'),
      ttfb: audit('server-response-time'),
      si: audit('speed-index'),
    };
  } finally {
    await chrome.kill();
  }
}

const now = new Date();
const slot = resolveSlot(now);
const rows = [];
let failedUrls = 0;

for (const device of config.devices) {
  for (const url of urls) {
    await warmUp(url);
    const runs = [];
    for (let i = 0; i < runsPerUrl; i++) {
      try {
        runs.push(await singleRun(url, device));
      } catch (error) {
        console.error(`  run ${i + 1} failed for ${url} (${device}): ${error.message}`);
      }
    }
    if (!runs.length) {
      failedUrls++;
      continue;
    }
    const med = (key) => median(runs.map((r) => r[key]).filter((v) => typeof v === 'number'));
    const round = (v, d) => Number(v.toFixed(d));
    rows.push([
      now.toISOString(), slot, url, device, runs.length,
      round(med('score'), 0), round(med('lcp'), 0), round(med('cls'), 4),
      round(med('tbt'), 0), round(med('fcp'), 0), round(med('ttfb'), 0), round(med('si'), 0),
    ].join(','));
    console.log(`${device} ${url} -> score ${med('score')}, LCP ${Math.round(med('lcp'))}ms (${runs.length} runs)`);
  }
}

if (rows.length) {
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  const prefix = fs.existsSync(csvPath) ? '' : HEADER + '\n';
  fs.appendFileSync(csvPath, prefix + rows.join('\n') + '\n');
}

if (failedUrls) {
  console.error(`${failedUrls} URL(s) had no successful runs.`);
  process.exitCode = 1;
}
