// Builds a page for every product at /p/<id>/ plus sitemap.xml.
//
// Each page is a copy of the storefront (index.html) that opens straight on
// that product, with its own title, description, canonical URL, link-preview
// tags (WhatsApp, Instagram, Facebook, X, iMessage) and schema.org Product
// data for Google. Link-preview crawlers ignore everything after "#" and
// don't run JavaScript, so #product/<id> links alone can't do this.
//
// Run with Node 18+ (no dependencies):  node scripts/build-product-pages.mjs
// The "Product link previews" GitHub Action runs it hourly.

import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
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
      products.push({ id: doc.name.split('/').pop(), updateTime: doc.updateTime, ...decodeFields(doc.fields || {}) });
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

const TEMPLATE = readFileSync('index.html', 'utf8');
const HEAD_START = TEMPLATE.indexOf('<title>');
const HEAD_END_MARK = '<meta name="twitter:image:alt"';
const HEAD_END = TEMPLATE.indexOf('\n', TEMPLATE.indexOf(HEAD_END_MARK)) + 1;
if (HEAD_START < 0 || HEAD_END <= 0 || !TEMPLATE.includes('<body data-page="site">')) {
  throw new Error('index.html no longer matches what build-product-pages.mjs expects (title/meta block or <body data-page="site">).');
}

// Safe inside <script type="application/ld+json">.
const jsonLd = (obj) => JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');

function pageFor(p) {
  const id = encodeURIComponent(p.id);
  const url = `${SITE}/p/${id}/`;
  const name = p.name || 'ASIORA';
  const title = `${name} — ASIORA`;
  const category = CATEGORY_LABELS[p.category] || '';
  const price = Math.round(Number(p.price) || 0);
  const descParts = [fmtIQD(price)];
  if (p.desc) descParts.push(p.desc);
  else if (category) descParts.push(`${category} by ASIORA, Erbil.`);
  const notes = p.notes || {};
  const tiers = ['top', 'heart', 'base'].map(k => (Array.isArray(notes[k]) ? notes[k].filter(Boolean) : [])).filter(t => t.length);
  if (tiers.length) descParts.push('Notes: ' + tiers.map(t => t.join(', ')).join(' / '));
  const description = descParts.join(' · ');
  const image = absoluteImage(p.image);

  const product = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    image: [image],
    description,
    sku: p.id,
    brand: { '@type': 'Brand', name: 'ASIORA' },
    ...(category ? { category } : {}),
    offers: {
      '@type': 'Offer',
      url,
      price: String(price),
      priceCurrency: 'IQD',
      availability: (Number(p.stock) || 0) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: 'ASIORA' },
    },
  };

  const head = `<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#F3EEE5">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="ASIORA">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:secure_url" content="${esc(image)}">
<meta property="og:image:alt" content="${esc(name)}">
<meta property="product:price:amount" content="${price}">
<meta property="product:price:currency" content="IQD">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<script type="application/ld+json">
${jsonLd(product)}
</script>
`;

  return (TEMPLATE.slice(0, HEAD_START) + head + TEMPLATE.slice(HEAD_END))
    // Pages live two folders down, so make site-relative asset paths absolute.
    .replace(/(["'(])images\//g, '$1/images/')
    .replace('<body data-page="site">', `<body data-page="site" data-product="${esc(p.id)}">`);
}

function sitemap(products) {
  const urls = [{ loc: `${SITE}/`, lastmod: null }]
    .concat(products.map(p => ({ loc: `${SITE}/p/${encodeURIComponent(p.id)}/`, lastmod: (p.updateTime || '').slice(0, 10) || null })));
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
}

const products = await fetchProducts();
if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
for (const p of products) {
  const dir = join(OUT_DIR, encodeURIComponent(p.id));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), pageFor(p));
}
writeFileSync('sitemap.xml', sitemap(products));
console.log(`Wrote ${products.length} product page(s) to ${OUT_DIR}/ and sitemap.xml`);
