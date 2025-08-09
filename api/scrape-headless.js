import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { sendCors, requireAuth } from './_cors.js';

export default async function handler(req, res) {
  if (sendCors(req, res)) return;
  if (!requireAuth(req, res)) return;

  const u = new URL(req.url, 'http://x');
  const target = u.searchParams.get('u');
  if (!target) return res.status(400).json({ ok: false, error: 'missing u' });

  let browser;
  try {
    const executablePath = await chromium.executablePath;
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      headless: chromium.headless,
      executablePath
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36');

    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 25000 });
    const finalUrl = page.url();
    await page.waitForTimeout(2500);

    const data = await page.evaluate(() => {
      const by = (sel) => document.querySelector(sel);
      const getMeta = (p) => document.querySelector(`meta[property="${p}"]`)?.content || '';
      const title = getMeta('og:title') || document.title || '';
      const image = getMeta('og:image') || '';
      const priceCand = ['[class*="price"]','[class*="current-price"]','[class*="product-price"]','[data-sqe="price"]','._3e_UQT'];
      let price = '';
      for (const sel of priceCand) {
        const el = by(sel);
        if (el && el.textContent && /\d/.test(el.textContent)) { price = el.textContent.trim(); break; }
      }
      return { title, image, price };
    });

    await browser.close();
    res.json({ ok: true, mode: 'headless', finalUrl, ...data });
  } catch (e) {
    if (browser) try { await browser.close(); } catch {}
    res.status(500).json({ ok: false, error: String(e?.message||e) });
  }
}
