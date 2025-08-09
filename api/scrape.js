import fetch from 'node-fetch';
import { createHash } from 'crypto';
import { sendCors, requireAuth } from './_cors.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';

function setNoCache(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
}

const brlFromInt = (p) => (p==null? '' : ('R$ ' + (Number(p)/100000).toFixed(2).replace('.', ',')));
const toBRL = (x) => {
  if (x == null || x === '') return '';
  let s = String(x).replace(/[^\d.,]/g,'');
  if (!s) return '';
  if (!/[.,]/.test(s)) s = s.replace(/(\d+)(\d{2})$/, '$1,$2');
  return 'R$ ' + s;
};

function parseIds(u) {
  try {
    const url = new URL(u);
    const m = url.pathname.match(/(?:^|\/)i\.(\d+)\.(\d+)(?:$|[/?])/i);
    if (m) return { shopid: m[1], itemid: m[2] };
  } catch {}
  return { shopid: null, itemid: null };
}

const md5 = (s) => createHash('md5').update(s).digest('hex');

// Shopee exige esse cabeçalho:  if-none-match-: 55b03-${ md5('55b03' + md5(qs) + '55b03') }
// onde qs = `itemid=${itemid}&shopid=${shopid}`
function makeIfNoneMatch(itemid, shopid) {
  const qs = `itemid=${itemid}&shopid=${shopid}`;
  const qsHash = md5(qs);
  const none = md5(`55b03${qsHash}55b03`);
  return `55b03-${none}`;
}

async function followUrl(u) {
  try {
    const r = await fetch(u, { headers: { 'user-agent': UA }, redirect: 'follow' });
    return r.url || u;
  } catch { return u; }
}

async function fetchJson(url, headers = {}) {
  const r = await fetch(url, { headers: { 'user-agent': UA, ...headers }, redirect: 'follow' }).catch(()=>null);
  if (!r || !r.ok) return null;
  const txt = await r.text().catch(()=> '');
  try { return JSON.parse(txt); } catch { return null; }
}

async function fetchText(url, headers = {}) {
  const r = await fetch(url, { headers: { 'user-agent': UA, ...headers }, redirect: 'follow' }).catch(()=>null);
  if (!r || !r.ok) return '';
  return await r.text().catch(()=> '');
}

// tenta extrair um JSON "item" de um texto (fallback via Jina)
function extractJsonFromText(text) {
  const m = text.match(/"item"\s*:\s*{[\s\S]*?}\s*(?=[,}])/);
  if (m) {
    try { return JSON.parse('{' + m[0] + '}'); } catch {}
  }
  return null;
}

async function getItemFromV2(shopid, itemid, referer) {
  const ifNone = makeIfNoneMatch(itemid, shopid);
  const url = `https://shopee.com.br/api/v2/item/get?itemid=${itemid}&shopid=${shopid}`;
  const headers = {
    'accept': 'application/json',
    'accept-language': 'pt-BR,pt;q=0.9',
    'referer': referer || 'https://shopee.com.br/',
    'x-api-source': 'pc',
    'x-shopee-language': 'pt-BR',
    'if-none-match-': ifNone
  };
  const j = await fetchJson(url, headers);
  if (j && (j.item || j.data)) return j.item || j.data;

  // fallback via Jina (vem texto, extraímos JSON do meio)
  const thru = 'https://r.jina.ai/http://shopee.com.br/api/v2/item/get?itemid=' + itemid + '&shopid=' + shopid;
  const txt = await fetchText(thru, headers);
  const j2 = extractJsonFromText(txt);
  if (j2 && (j2.item || j2.data)) return j2.item || j2.data;

  return null;
}

async function getItemFromV4(shopid, itemid, referer) {
  const url = `https://shopee.com.br/api/v4/item/get?shopid=${shopid}&itemid=${itemid}`;
  const headers = {
    'accept': 'application/json',
    'accept-language': 'pt-BR,pt;q=0.9',
    'referer': referer || 'https://shopee.com.br/',
    'x-api-source': 'pc',
    'x-shopee-language': 'pt-BR'
  };
  const j = await fetchJson(url, headers);
  if (j && (j.item || j.data)) return j.item || j.data;
  return null;
}

async function getReadable(u) {
  const thru = 'https://r.jina.ai/http://' + u.replace(/^https?:\/\//,'');
  return await fetchText(thru, { 'accept-language': 'pt-BR,pt;q=0.9' });
}

function extractFromReadable(text) {
  let title = '';
  let image = '';
  let price = '';

  let m = text.match(/og:title["']?\s*content=["']([^"\n]{5,})/i) || text.match(/"name"\s*:\s*"([^"]{5,})"/i);
  if (m) title = m[1];

  const priceRX = [
    /"price_min"\s*:\s*([\d.]+)/i,
    /"price"\s*:\s*"?([\d.,]+)"?/i,
    /"current_price"\s*:\s*([\d.]+)/i,
    /"final_price"\s*:\s*([\d.]+)/i,
    /"price_before_discount"\s*:\s*([\d.]+)/i,
    /R\$\s*([\d.,]+)/i
  ];
  for (const rx of priceRX) {
    const pm = text.match(rx);
    if (pm && pm[1]) { price = pm[1]; break; }
  }

  m = text.match(/"image(?:s)?"\s*:\s*\[\s*"([^"]+)"/i) || text.match(/"image"\s*:\s*"([^"]+)"/i);
  if (m) image = m[1];
  if (image && !/^https?:\/\//i.test(image) && image.length > 20) {
    image = `https://cf.shopee.com.br/file/${image}`;
  }

  return {
    title: (title||'').replace(/\s+/g, ' ').trim(),
    price: toBRL(price),
    image: (image||'').trim()
  };
}

export default async function handler(req, res) {
  if (sendCors(req, res)) return;
  if (!requireAuth(req, res)) return;
  setNoCache(res);

  try {
    const u = new URL(req.url, 'http://x');
    const target = u.searchParams.get('u');
    if (!target) return res.status(400).json({ ok: false, error: 'missing u' });

    const finalUrl = await followUrl(target);
    let { shopid, itemid } = parseIds(finalUrl);

    // 1) tentar API v2 com if-none-match-
    if (shopid && itemid) {
      let item = await getItemFromV2(shopid, itemid, finalUrl);
      if (!item) {
        // 2) fallback v4
        item = await getItemFromV4(shopid, itemid, finalUrl);
      }
      if (item) {
        const title = item.name || '';
        const hash = item.image || (Array.isArray(item.images) && item.images[0]) || '';
        const image = hash ? `https://cf.shopee.com.br/file/${hash}` : '';
        const raw = item.price_min ?? item.price ?? item.current_price ?? item.final_price;
        const price = raw != null ? brlFromInt(raw) : '';
        return res.json({ ok: true, mode: 'api', finalUrl, title, image, price });
      }
    }

    // 3) último recurso: página renderizada via Jina
    const text = await getReadable(finalUrl);
    const { title, price, image } = extractFromReadable(text);
    return res.json({ ok: true, mode: 'readable', finalUrl, title, image, price });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
