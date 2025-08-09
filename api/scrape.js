import fetch from 'node-fetch';
import { sendCors, requireAuth } from './_cors.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';

function formatBRLFromShopeeInt(p) {
  // preços da Shopee geralmente vêm multiplicados por 100000
  if (p == null) return '';
  const val = Number(p) / 100000;
  if (!isFinite(val)) return '';
  return 'R$ ' + val.toFixed(2).replace('.', ',');
}

function parseIdsFromUrl(u) {
  try {
    const url = new URL(u);
    // padrão i.shopid.itemid (ex.: .../i.1053396617.22498011626)
    const m = url.pathname.match(/(?:^|\/)i\.(\d+)\.(\d+)(?:$|\/|\?)/i);
    if (m) return { shopid: m[1], itemid: m[2] };
  } catch {}
  return { shopid: null, itemid: null };
}

async function fetchItem(shopid, itemid, referer) {
  const endpoints = [
    `https://shopee.com.br/api/v4/item/get?shopid=${shopid}&itemid=${itemid}`,
    `https://shopee.com.br/api/v2/item/get?shopid=${shopid}&itemid=${itemid}`,
  ];
  for (const ep of endpoints) {
    const r = await fetch(ep, {
      headers: {
        'user-agent': UA,
        'accept': 'application/json',
        'accept-language': 'pt-BR,pt;q=0.9',
        'referer': referer || 'https://shopee.com.br/'
      },
      redirect: 'follow'
    });
    if (r.ok) {
      const j = await r.json().catch(() => null);
      if (j && (j.item || j.data)) return j.item || j.data;
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (sendCors(req, res)) return;
  if (!requireAuth(req, res)) return;

  try {
    const u = new URL(req.url, 'http://x');
    const target = u.searchParams.get('u');
    if (!target) return res.status(400).json({ ok: false, error: 'missing u' });

    // extrai ids do próprio link
    let { shopid, itemid } = parseIdsFromUrl(target);

    // se não achou, ainda tenta seguir o link (p/ redirecionadores) e re-extrair
    let finalUrl = target;
    if (!shopid || !itemid) {
      const r = await fetch(target, { headers: { 'user-agent': UA }, redirect: 'follow' });
      finalUrl = r.url;
      ({ shopid, itemid } = parseIdsFromUrl(finalUrl));
    }

    if (!shopid || !itemid) {
      return res.json({ ok: true, mode: 'simple', finalUrl, title: '', image: '', price: '' });
    }

    const item = await fetchItem(shopid, itemid, finalUrl);
    if (!item) {
      return res.json({ ok: true, mode: 'simple', finalUrl, title: '', image: '', price: '' });
    }

    const title = item.name || '';
    const imgHash =
      (item.image) ||
      (Array.isArray(item.images) && item.images.length ? item.images[0] : '');
    const image = imgHash ? `https://cf.shopee.com.br/file/${imgHash}` : '';

    const price =
      formatBRLFromShopeeInt(item.price_min ?? item.price ?? item.current_price ?? item.final_price);

    return res.json({
      ok: true,
      mode: 'simple',
      finalUrl: `https://shopee.com.br/i.${shopid}.${itemid}`,
      title,
      image,
      price
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
