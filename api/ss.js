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
    try {
      const r = await fetch(url, { headers: ssHeaders });
      const text = await r.text();
      try { return { ok: r.ok, status: r.status, data: JSON.parse(text) }; }
      catch { return { ok: r.ok, status: r.status, data: null, raw: text }; }
    } catch(e) {
      console.error('S&S fetch error:', url, e.message);
      return { ok: false, status: 0, data: null };
    }
  };

  const { path = 'styles', q, ...params } = req.query;

  try {
    // ── Smart search ─────────────────────────────────────────────────────────
    if (path === 'search') {
      if (!q || !q.trim()) return res.status(200).json({ type: 'none', results: [] });

      const query = q.trim();
      const terms = query.split(/\s+/).filter(Boolean);

      // Build style ID candidates: individual terms + adjacent pairs
      // S&S API uses lowercase 'styleid' param
      const candidates = new Set();
      terms.forEach((t, i) => {
        const clean = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (clean.length > 1) candidates.add(clean);
        if (i < terms.length - 1) {
          const pair = clean + terms[i + 1].toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (pair.length > 2) candidates.add(pair);
        }
      });

      // Try each candidate as a direct style ID (S&S param: styleid)
      for (const candidate of candidates) {
        const r = await ssGet('products/', { styleid: candidate });
        if (r.ok && Array.isArray(r.data) && r.data.length > 0) {
          // Get style info
          const sr = await ssGet('styles/', { styleid: candidate });
          const styleInfo = (sr.ok && Array.isArray(sr.data) && sr.data[0])
            || { styleID: candidate, title: candidate, brandName: '' };
          console.log('S&S direct match:', candidate, '->', r.data.length, 'products');
          return res.status(200).json({ type: 'direct', styleInfo, products: r.data });
        }
      }

      // Text/brand search — S&S styles endpoint supports ?search= for keyword search
      const searchTerms = terms.filter(t => t.length > 2);
      if (searchTerms.length > 0) {
        // Try the full query as a search
        const r = await ssGet('styles/', { search: query });
        if (r.ok && Array.isArray(r.data) && r.data.length > 0) {
          console.log('S&S text search:', query, '->', r.data.length, 'results');
          return res.status(200).json({ type: 'styles', results: r.data.slice(0, 40) });
        }

        // Try each significant term as a search
        for (const term of searchTerms) {
          const r2 = await ssGet('styles/', { search: term });
          if (r2.ok && Array.isArray(r2.data) && r2.data.length > 0) {
            // Filter by remaining terms
            const rest = terms.filter(t => t.toLowerCase() !== term.toLowerCase()).map(t => t.toLowerCase());
            const filtered = rest.length
              ? r2.data.filter(s => {
                  const text = `${s.styleID || ''} ${s.title || ''} ${s.categoryName || ''} ${s.brandName || ''}`.toLowerCase();
                  return rest.every(t => text.includes(t));
                })
              : r2.data;
            if (filtered.length > 0) {
              console.log('S&S term search:', term, '->', filtered.length, 'filtered results');
              return res.status(200).json({ type: 'styles', results: filtered.slice(0, 40) });
            }
          }
        }
      }

      console.log('S&S search: no results for query:', query);
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
    console.error('S&S proxy error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
