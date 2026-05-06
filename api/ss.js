// api/ss.js — S&S Activewear API proxy
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const account = process.env.SS_ACCOUNT;
  const apiKey  = process.env.SS_API_KEY;
  if (!account || !apiKey) {
    return res.status(500).json({ error: 'S&S credentials not configured on server.' });
  }

  const auth = Buffer.from(`${account}:${apiKey}`).toString('base64');
  const ssHeaders = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' };

  const ssGet = async (endpoint, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    const url = `https://api.ssactivewear.com/v2/${endpoint}${qs ? '?' + qs : ''}`;
    const r = await fetch(url, { headers: ssHeaders });
    const text = await r.text();
    try { return { ok: r.ok, status: r.status, data: JSON.parse(text) }; }
    catch { return { ok: r.ok, status: r.status, data: null, raw: text }; }
  };

  const { path = 'styles', q, ...params } = req.query;

  try {
    // ── Smart search ─────────────────────────────────────────────────────────
    if (path === 'search') {
      if (!q || !q.trim()) return res.status(200).json({ type: 'none', results: [] });

      const query = q.trim();
      const terms = query.split(/\s+/).filter(Boolean);

      // Build style ID candidates: individual terms + adjacent pairs
      const candidates = new Set();
      terms.forEach((t, i) => {
        const clean = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (clean.length > 1) candidates.add(clean);
        if (i < terms.length - 1) {
          const pair = clean + terms[i + 1].toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (pair.length > 2) candidates.add(pair);
        }
      });

      // Try each candidate as a direct style ID → products endpoint
      for (const candidate of candidates) {
        const r = await ssGet('products/', { StyleID: candidate });
        if (r.ok && Array.isArray(r.data) && r.data.length > 0) {
          // Get style info too
          const sr = await ssGet('styles/', { StyleID: candidate });
          const styleInfo = (sr.ok && Array.isArray(sr.data) && sr.data[0]) || { styleID: candidate, title: candidate, brandName: '' };
          return res.status(200).json({ type: 'direct', styleInfo, products: r.data });
        }
      }

      // Brand/title search — fetch by brand name (non-numeric terms)
      const brandTerms = terms.filter(t => !/^\d/.test(t) && t.length > 2);
      if (brandTerms.length > 0) {
        for (const brand of brandTerms) {
          const r = await ssGet('styles/', { BrandName: brand });
          if (r.ok && Array.isArray(r.data) && r.data.length > 0) {
            // Filter by remaining terms
            const remaining = terms.filter(t => t.toLowerCase() !== brand.toLowerCase()).map(t => t.toLowerCase());
            const filtered = remaining.length
              ? r.data.filter(s => {
                  const text = `${s.styleID || ''} ${s.title || ''} ${s.categoryName || ''}`.toLowerCase();
                  return remaining.every(t => text.includes(t));
                })
              : r.data;
            if (filtered.length > 0) {
              return res.status(200).json({ type: 'styles', results: filtered.slice(0, 40) });
            }
          }
        }
      }

      return res.status(200).json({ type: 'none', results: [] });
    }

    // ── Pass-through for all other S&S endpoints ──────────────────────────
    const qs = new URLSearchParams(params).toString();
    const url = `https://api.ssactivewear.com/v2/${path}/${qs ? '?' + qs : ''}`;
    const r = await fetch(url, { headers: ssHeaders });
    const text = await r.text();
    res.setHeader('Content-Type', 'application/json');
    res.status(r.ok ? 200 : r.status).send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
