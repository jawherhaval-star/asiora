// Builds a small static page for every product at /p/<id>/ so that links
// shared on WhatsApp, Instagram, Facebook, X, iMessage etc. show that
// product's photo, name and price in the preview card.
//
// Link-preview crawlers ignore everything after "#" and don't run
// JavaScript, so the storefront's #product/<id> links can't carry
// per-product previews. These pages carry the preview tags and then send
// real visitors straight on to /#product/<id>.
//
// Run with Node 18+ (no dependencies):  node scripts/build-product-pages.mjs
// The "Product link previews" GitHub Action runs it hourly.

import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ID = 'asiora-c2097';
// Public Firebase web key — the same one the storefront ships in index.html.
const API_KEY = 'AIzaSyA7JuCwYZk8h9mguDG0UfQjzvUPk66ruJQ';
const SITE = 'https://asioraofficial.com';
const FALLBACK_IMAGE = `${SITE}/images/og-asiora.jpg`;
const OUT_DIR = 'p';

const CATEGORY_LABELS = {
  WMN: 'Womenswear', MEN: 'Menswear', ACC: 'Accessories', SHO: 'Footwear',
  HME: 'Home & Living', BTY: 'Cosmetic', KID: 'Kidswear', FRG: 'Fragrance',
};

function decode(value) {
  if (!value || typeof value !== 'object') return undefined;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  return undefined;
}
function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decode(v);
  return out;
}

async function fetchProducts() {
  const products = [];
  let pageToken = '';
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/products`);
    url.searchParams.set('pageSize', '300');
    url.searchParams.set('key', API_KEY);
    for (const f of ['name', 'price', 'stock', 'category', 'image', 'desc', 'notes']) url.searchParams.append('mask.fieldPaths', f);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Firestore request failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    for (const doc of data.documents || []) {
      products.push({ id: doc.name.split('/').pop(), ...decodeFields(doc.fields || {}) });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return products;
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtIQD = (n) => Math.round(Number(n) || 0).toLocaleString('en-US') + ' IQD';

function absoluteImage(src) {
  if (!src || typeof src !== 'string' || src.startsWith('data:')) return FALLBACK_IMAGE;
  if (/^https?:\/\//i.test(src)) return src;
  return `${SITE}/${src.replace(/^\.?\//, '')}`;
}

function pageFor(p) {
  const id = encodeURIComponent(p.id);
  const url = `${SITE}/p/${id}/`;
  const target = `/#product/${id}`;
  const name = p.name || 'ASIORA';
  const title = `${name} — ASIORA`;
  const category = CATEGORY_LABELS[p.category] || '';
  const descParts = [fmtIQD(p.price)];
  if (p.desc) descParts.push(p.desc);
  else if (category) descParts.push(`${category} by ASIORA, Erbil.`);
  const notes = p.notes || {};
  const tiers = ['top', 'heart', 'base'].map(k => (Array.isArray(notes[k]) ? notes[k].filter(Boolean) : [])).filter(t => t.length);
  if (tiers.length) descParts.push('Notes: ' + tiers.map(t => t.join(', ')).join(' / '));
  const description = descParts.join(' · ');
  const image = absoluteImage(p.image);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta name="theme-color" content="#F3EEE5">
<link rel="icon" type="image/png" sizes="64x64" href="/images/favicon-64.png">
<link rel="apple-touch-icon" href="/images/apple-touch-icon.png">
<meta property="og:type" content="product">
<meta property="og:site_name" content="ASIORA">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:secure_url" content="${esc(image)}">
<meta property="og:image:alt" content="${esc(name)}">
<meta property="product:price:amount" content="${esc(Math.round(Number(p.price) || 0))}">
<meta property="product:price:currency" content="IQD">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<script>location.replace(${JSON.stringify(target)});</script>
<style>
  body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;
    background:#F3EEE5;color:#14161F;font-family:Georgia,'Times New Roman',serif;text-align:center;padding:24px}
  img{width:180px;height:auto}
  a{color:#14161F;font-family:Arial,sans-serif;font-size:12px;letter-spacing:.2em;text-transform:uppercase}
</style>
</head>
<body>
<img src="/images/logo-asiora.webp" alt="ASIORA">
<p>${esc(name)}</p>
<a href="${esc(target)}">View on ASIORA</a>
</body>
</html>
`;
}

const products = await fetchProducts();
if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
for (const p of products) {
  const dir = join(OUT_DIR, encodeURIComponent(p.id));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), pageFor(p));
}
console.log(`Wrote ${products.length} product page(s) to ${OUT_DIR}/`);
