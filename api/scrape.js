import fetch from 'node-fetch';
import { sendCors, requireAuth } from './_cors.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';

// Normaliza preço para R$ x.xxx,yy
function toBRL(x) {
  if (!x && x !== 0) return '';
  let s = String(x).trim();
  // remove lixo
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return '';
  // se vier só dígitos, vira xx,yy
  if (!/[.,]/.test(s)) s = s.replace(/(\d+)(\d{2})$/, '$1,$2');
  return 'R$ ' + s;
}

// Extrai dados do texto plano renderizado pelo Jina
function extractFromText(t) {
  // título
  let title = '';
  // procura linha “og:title” ou \"name\"
  let m = t.match(/og:title["']?\s*content=["']([^"\n]{5,})/i) || t.match(/"name"\s*:\s*"([^"]{5,})"/i);
  if (m) title = m[1];

  // preço (vários padrões)
  let price = '';
  const priceRX = [
    /"price"\s*:\s*"?([\d.,]+)"?/i,
    /"current_price"\s*:\s*([\d.]+)/i,
    /"final_price"\s*:\s*([\d.]+)/i,
    /"price_before_discount"\s*:\s*([\d.]+)/i,
    /R\$\s*([\d.,]+)/i
  ];
  for (const rx of priceRX) {
    const pm = t.match(rx);
    if (pm && pm[1]) { price = pm[1]; break; }
  }

  // imagem (hash/URL)
  let image = '';
  m = t.match(/"image(?:s)?"\s*:\s*\[\s*"([^"]+)"/i) || t.match(/"image"\s*:\s*"([^"]+)"/i);
  if (m) image = m[1];
  if (image && !/^https?:\/\//i.test(image) && image.length > 20) {
    // Shopee costuma trazer só o hash
    image = `https://cf.shopee.com.br/file/${image}`;
  }

  return {
    title: (title || '').replace(/\s+/g, ' ').trim(),
    price: toBRL(price),
    image: (image || '').trim()
  };
}

export default async function handler(req, res) {
  if (sendCors(req, res)) return;
  if (!requireAuth(req, res)) return;

  try {
    const url = new URL(req.url, 'http://x');
    const target = url.searchParams.get('u');
    if (!target) return res.status(400).json({ ok: false, error: 'missing u' });

    // segue possíveis redirecionadores e guarda URL final
    let finalUrl = target;
    try {
      const r = await fetch(target, { headers: { 'user-agent': UA }, redirect: 'follow' });
      finalUrl = r.url || finalUrl;
    } catch {}

    // Lê a página via r.jina.ai (render reader)
    const jinaUrl = 'https://r.jina.ai/http://' + finalUrl.replace(/^https?:\/\//, '');
    const resp = await fetch(jinaUrl, {
      headers: { 'user-agent': UA, 'accept-language': 'pt-BR,pt;q=0.9' }
    });

    if (!resp.ok) {
      return res.status(502).json({ ok: false, error: 'reader failed', status: resp.status });
    }

    const text = await resp.text();
    const { title, price, image } = extractFromText(text);

    return res.json({
      ok: true,
      mode: 'reader',
      finalUrl,
      title,
      image,
      price
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
