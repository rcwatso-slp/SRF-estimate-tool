// api/ss.js — S&S Activewear API proxy
// Keeps account credentials on the server; browser never sees them.
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

  // The client passes ?path=products&StyleID=G500  (or any S&S v2 endpoint params)
  const { path = 'styles', ...params } = req.query;
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.ssactivewear.com/v2/${path}/${qs ? '?' + qs : ''}`;

  try {
    const r = await fetch(url, { headers: ssHeaders });
    const text = await r.text();
    res.setHeader('Content-Type', 'application/json');
    res.status(r.ok ? 200 : r.status).send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
