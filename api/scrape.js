import fetch from 'node-fetch';
import { sendCors, requireAuth } from './_cors.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';

const toBRL = (x) => {
  if (x == null || x === '') return '';
  const s = String(x).replace(/[^\d.,]/g, '');
  if (!s) return '';
  const n = /[.,]/.test(s) ? s : s.replace(/(\d+)(\d{2})$/, '$1,$2');
  return 'R$ ' + n;
};

function parseIdsFromUrl(u) {
  try {
    const url = new URL(u);
    const m = url.pathname.match(/(?:^|\/)i\.(\d+)\.(\d+)(?:$|[/?])/i);
    if (m) return { shopid: m[1], itemid: m[2] };
  } catch {}
  return { shopid: null, itemid: null };
}

async function callShopeeItemAPI(shopid, itemid, referer) {
  const eps = [
    `https://shopee.com.br/api/v4/item/get?shopid=${shopid}&itemid=${itemid}`,
    `https://shopee.com.br/api/v2/item/get?shopid=${shopid}&itemid=${itemid}`,
  ];
  for (const ep of eps) {
    const r = await fetch(ep, {
      headers: {
        'user-agent': UA,
        'accept': 'application/json',
        'accept-language': 'pt-BR,pt;q=0.9',
        'referer': referer || 'https://shopee.com.br/'
      },
      redirect: 'follow',
    }).catch(() => null);
    if (r && r.ok) {
      const j = await r.json().catch(() => null);
      if (j && (j.item || j.data)) return j.item || j.data;
    }
  }
  return null;
}

async function fetchReadable(url) {
  const reader = 'https://r.jina.ai/http://';
  const r = await fetch(reader + url.replace(/^https?:\/\//, ''), {
    headers: { 'user-agent': UA, 'accept-language': 'pt-BR,pt;q=0.9' },
    redirect: 'follow',
  });
  if (!r.ok) return '';
  return await r.text();
}

function extractFromReadable(text) {
  let title = '';
  let image = '';
  let price = '';

  // Título (linha com “og:title” ou “name”)
  let m = text.match(/og:title(?:")?\s*content="?([^\n"]{5,})/i) ||
          text.match(/"name"\s*:\s*"([^"]{5,})"/i);
  if (m) title = m[1];

  // Preço – vários padrões
  const priceRx = [
    /"price"\s*:\s*"?([\d.,]+)"?/i,
    /"current_price"\s*:\s*([\d.]+)/i,
    /"final_price"\s*:\s*([\d.]+)/i,
    /"price_before_discount"\s*:\s*([\d.]+)/i,
    /R\$\s*([\d.,]+)/i
  ];
  for (const rx of priceRx) {
    const pm = text.match(rx);
    if (pm && pm[1]) { price = pm[1]; break; }
  }

  // Imagem – hash/URL
  m = text.match(/"image(?:s)?"\s*:\s*\[\s*"([^"]+)"/i) ||
      text.match(/"image"\s*:\s*"([^"]+)"/i);
  if (m) image = m[1];
  if (image && !/^https?:\/\//i.test(image) && image.length > 20) {
    image = `https://cf.shopee.com.br/file/${image}`;
  }

  return { title: (title||'').trim(), price: toBRL(price), image: (image||'').trim() };
}

export default async function handler(req, res) {
  if (sendCors(req, res)) return;
  if (!requireAuth(req, res)) return;

  try {
    const u = new URL(req.url, 'http://x');
    const target = u.searchParams.get('u');
    if (!target) return res.status(400).json({ ok: false, error: 'missing u' });

    // segue redirecionadores p/ pegar URL final
    let finalUrl = target;
    const follow = await fetch(target, { headers: { 'user-agent': UA }, redirect: 'follow' }).catch(()=>null);
    if (follow && follow.url) finalUrl = follow.url;

    // 1) Tenta por shopid/itemid
    let { shopid, itemid } = parseIdsFromUrl(finalUrl);
    if (shopid && itemid) {
      const item = await callShopeeItemAPI(shopid, itemid, finalUrl);
      if (item) {
        const title = item.name || '';
        const imgHash = item.image || (Array.isArray(item.images) && item.images[0]) || '';
        const image = imgHash ? `https://cf.shopee.com.br/file/${imgHash}` : '';
        const rawPrice = item.price_min ?? item.price ?? item.current_price ?? item.final_price ?? '';
        // preços da Shopee costumam vir x100000
        const price = rawPrice ? ('R$ ' + (Number(rawPrice)/100000).toFixed(2).replace('.', ',')) : '';
        return res.json({ ok: true, mode: 'api', finalUrl, title, image, price });
      }
    }

    // 2) Fallback: reader
    const readable = await fetchReadable(finalUrl);
    const { title, price, image } = extractFromReadable(readable);

    return res.json({ ok: true, mode: 'readable', finalUrl, title, image, price });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
