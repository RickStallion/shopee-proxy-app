import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { sendCors, requireAuth } from './_cors.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';

const pick = (...vals) => {
  for (const v of vals) if (v && String(v).trim()) return String(v).trim();
  return '';
};
const toBRL = (x) => {
  if (!x) return '';
  const s = String(x).replace(/[^\d.,]/g, '');
  if (!s) return '';
  // se vier só dígitos (ex.: 12345 -> 123,45)
  const norm = /[\.,]/.test(s) ? s : s.replace(/(\d{1,})(\d{2})$/, '$1,$2');
  return 'R$ ' + norm;
};

export default async function handler(req, res) {
  if (sendCors(req, res)) return;
  if (!requireAuth(req, res)) return;

  try {
    const u = new URL(req.url, 'http://x');
    const target = u.searchParams.get('u');
    if (!target) return res.status(400).json({ ok: false, error: 'missing u' });

    const r = await fetch(target, {
      redirect: 'follow',
      headers: {
        'user-agent': UA,
        'accept-language': 'pt-BR,pt;q=0.9',
        'accept': 'text/html,application/xhtml+xml',
      },
    });

    const finalUrl = r.url;
    const html = await r.text();
    const $ = cheerio.load(html);

    // 1) Título/imagem via metatags comuns
    let title =
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('h1').first().text() ||
      $('title').text();

    let image =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      '';

    // 2) Tenta JSON-LD (Product/Offer)
    let price = '';
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const obj = JSON.parse($(el).text());
        const arr = Array.isArray(obj) ? obj : [obj];
        for (const it of arr) {
          if (it['@type'] === 'Product' || it.product || it.offers) {
            const offers = it.offers || (it['@type'] === 'Offer' ? it : null);
            if (offers) {
              price = pick(price, offers.price, offers.lowPrice, offers.highPrice);
            }
            title = pick(title, it.name);
            image = pick(image, Array.isArray(it.image) ? it.image[0] : it.image);
          }
        }
      } catch {}
    });

    // 3) Caça nos <script> (Shopee embute blobs grandes)
    const scripts = $('script').map((_, el) => $(el).html() || '').get().join('\n');
    if (!price) {
      // vários padrões possíveis
      const patterns = [
        /"price"\s*:\s*"?\s*([\d.,]+)"/i,
        /"current_price"\s*:\s*([\d.]+)/i,
        /"final_price"\s*:\s*([\d.]+)/i,
        /"price_before_discount"\s*:\s*([\d.]+)/i,
        /"raw_price"\s*:\s*([\d.]+)/i,
      ];
      for (const rx of patterns) {
        const m = scripts.match(rx);
        if (m && m[1]) { price = m[1]; break; }
      }
    }
    if (!title) {
      const m = scripts.match(/"name"\s*:\s*"([^"]{5,})"/i);
      if (m) title = m[1];
    }
    if (!image) {
      const m = scripts.match(/"image(?:s)?"\s*:\s*\[\s*"([^"]+)"/i) || scripts.match(/"image"\s*:\s*"([^"]+)"/i);
      if (m) image = m[1];
    }

    // 4) Últimos fallbacks: meta description às vezes carrega o nome
    if (!title) {
      title = $('meta[name="description"]').attr('content') || title;
    }

    title = (title || '').replace(/\s+/g, ' ').trim();
    price = toBRL(price);
    image = image ? String(image).trim() : '';

    return res.json({
      ok: true,
      mode: 'simple',
      finalUrl,
      title,
      image,
      price,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
