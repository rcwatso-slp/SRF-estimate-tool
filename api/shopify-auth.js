// api/shopify-auth.js — One-time Shopify OAuth callback handler
// Visit this page after authorizing the app to get your permanent access token.
module.exports = async function handler(req, res) {
  const { code, shop } = req.query;

  if (!code || !shop) {
    return res.status(200).send(`
      <html><body style="font-family:sans-serif;padding:40px;max-width:600px">
        <h2>Shopify Auth Setup</h2>
        <p>This endpoint is waiting for a Shopify OAuth callback.</p>
        <p>Follow the setup instructions to generate your access token.</p>
      </body></html>
    `);
  }

  const clientId     = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).send(`
      <html><body style="font-family:sans-serif;padding:40px">
        <h2 style="color:red">Missing env vars</h2>
        <p>Add SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET to Vercel environment variables.</p>
      </body></html>
    `);
  }

  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const tokenData = await tokenRes.json();
    const token = tokenData.access_token;

    if (!token) {
      return res.status(400).send(`
        <html><body style="font-family:sans-serif;padding:40px">
          <h2 style="color:red">Token exchange failed</h2>
          <pre>${JSON.stringify(tokenData, null, 2)}</pre>
        </body></html>
      `);
    }

    return res.status(200).send(`
      <html><body style="font-family:sans-serif;padding:40px;max-width:700px">
        <h2 style="color:green">✓ Success! Your Shopify Access Token:</h2>
        <div style="background:#f0f9f0;border:2px solid #16a34a;border-radius:8px;padding:20px;margin:20px 0">
          <code style="font-size:16px;word-break:break-all;font-weight:bold">${token}</code>
        </div>
        <p><strong>Copy that token now</strong> — add it to Vercel as an environment variable named <code>SHOPIFY_ACCESS_TOKEN</code>.</p>
        <p>Shop: <code>${shop}</code></p>
        <p style="color:#6b7280;font-size:13px">This page is safe to close after copying the token. The token is permanent and won't expire.</p>
      </body></html>
    `);
  } catch (err) {
    return res.status(500).send(`
      <html><body style="font-family:sans-serif;padding:40px">
        <h2 style="color:red">Error</h2>
        <p>${err.message}</p>
      </body></html>
    `);
  }
};
