import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { sendCors, requireAuth } from './_cors.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';

export default async function handler(req, res) {
  if (sendCors(req, res)) return;
  if (!requireAuth(req, res)) return;

  try {
    const u = new URL(req.url, 'http://x');
    const target = u.searchParams.get('u');
    if (!target) return res.status(400).json({ ok: false, error: 'missing u' });

    const r = await fetch(target, { redirect: 'follow', headers: { 'user-agent': UA } });
    const finalUrl = r.url;
    const html = await r.text();

    const $ = cheerio.load(html);
    const title = $('meta[property="og:title"]').attr('content') || $('title').text().trim();
    const image = $('meta[property="og:image"]').attr('content') || '';

    // tentar pegar preço via JSON-LD
    const ldjson = $('script[type="application/ld+json"]').map((i,el)=>$(el).text()).get().join('\n');
    let price = '';
    try {
      const blocks = ldjson.split(/\n+/).map(t=>t.trim()).filter(Boolean);
      for (const t of blocks) {
        const obj = JSON.parse(t);
        const arr = Array.isArray(obj) ? obj : [obj];
        for (const it of arr) {
          const offers = it.offers || it.Offers || (it['@type']==='Offer'? it : null);
          if (offers) {
            const p = offers.price || offers.lowPrice || offers.highPrice;
            if (p) { price = `R$ ${String(p).replace('.', ',')}`; break; }
          }
        }
        if (price) break;
      }
    } catch {}

    res.json({ ok: true, mode: 'simple', finalUrl, title, image, price });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message||e) });
  }
}
