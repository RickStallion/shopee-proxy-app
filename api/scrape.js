import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { sendCors, requireAuth } from './_cors.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';

function pickFirst(...vals) {
  for (const v of vals) if (v && String(v).trim()) return String(v).trim();
  return '';
}

function toBRL(x) {
  if (!x) return '';
  const s = String(x).replace(/[^\d.,]/g, '');
  if (!s) return '';
  // normaliza para R$ 1.234,56
  const n = s.includes(',') && s.includes('.')
    ? s
    : s.replace(/(\d+)(\d{2})$/, '$1,$2');
  return `R$ ${n}`;
}

export default async function handler(req, res) {
  if (sendCors(req, res)) return;
  if (!requireAuth(req, res)) return;

  try {
    const u = new URL(req.url, 'http://x');
    const target = u.searchParams.get('u');
    if (!target) return res.status(400).json({ ok: false, error: 'missing u' });

    const r = await fetch(target, {
      redirect: 'follow',
      headers: { 'user-agent': UA, 'accept-language': 'pt-BR,pt;q=0.9' },
    });

    const finalUrl = r.url;
    const html = await r.text();
    const $ = cheerio.load(html);

    // 1) Open Graph / elementos básicos
    let title =
      $('meta[property="og:title"]').attr('content') ||
      $('h1').first().text() ||
      $('title').text();

    let image =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      '';

    // 2) JSON-LD padrão (Product / Offer)
    let price = '';
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const txt = $(el).text();
        const obj = JSON.parse(txt);
        const arr = Array.isArray(obj) ? obj : [obj];
        for (const it of arr) {
          if (it['@type'] === 'Product' || it.product || it.offers) {
            const offers = it.offers || it.Offers || (it['@type'] === 'Offer' ? it : null);
            if (offers) {
              price =
                offers.price ||
                offers.lowPrice ||
                offers.highPrice ||
                price;
            }
            title = pickFirst(title, it.name);
            image = pickFirst(image, (it.image && (Array.isArray(it.image) ? it.image[0] : it.image)));
          }
        }
      } catch (_) {}
    });

    // 3) Regex em scripts embutidos (Shopee usa blobs grandes)
    if (!price) {
      const scripts = $('script')
        .map((_, el) => $(el).html() || '')
        .get()
        .join('\n');

      // tenta capturar "price" em blobs JSON
      const m1 = scripts.match(/"price"\s*:\s*"?([\d.,]+)"?/i);
      if (m1) price = m1[1];

      // tenta um título alternativo
      if (!title) {
        const m2 = scripts.match(/"name"\s*:\s*"([^"]{5,})"/i);
        if (m2) title = m2[1];
      }

      // tenta imagem em arrays de imagens
      if (!image) {
        const m3 = scripts.match(/"image(?:s)?"\s*:\s*\[\s*"([^"]+)"/i);
        if (m3) image = m3[1];
      }
    }

    // Normalizações finais
    title = (title || '').replace(/\s+/g, ' ').trim();
    price = toBRL(price);
    image = image ? String(image).trim() : '';

    res.json({
      ok: true,
      mode: 'simple',
      finalUrl,
      title,
      image,
      price,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
