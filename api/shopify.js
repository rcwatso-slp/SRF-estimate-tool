// api/shopify.js — Create Shopify draft orders from SRF estimates
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }

  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  const store = process.env.SHOPIFY_STORE;
  if (!token || !store) {
    return res.status(500).json({ error: 'Shopify credentials not configured on server.' });
  }

  const { items, clientName, estimateNumber, estimateDate, notes, discountAmount, discountedTotal, totals } = req.body;

  if (!items || !items.length) {
    return res.status(400).json({ error: 'No items provided.' });
  }

  // Build line items — one per estimate row
  const lineItems = items.map(item => {
    const qty   = item.qty || 1;
    const price = item.sellPerUnit != null
      ? parseFloat(item.sellPerUnit).toFixed(2)
      : parseFloat(item.totalSell / qty).toFixed(2);

    let title = item.description || 'Custom Item';
    if (item.decorationType) {
      const decLabel = item.decorationType === 'patch' ? 'Heat-Applied Patch'
        : item.decorationType === 'ucm' ? 'UCM Transfer'
        : 'Screen Print Transfer';
      title += ` — ${decLabel}`;
    }

    return {
      title,
      price,
      quantity: qty,
      taxable: false,
      requires_shipping: false,
    };
  });

  // Build note attributes
  const noteAttributes = [];
  if (estimateNumber) noteAttributes.push({ name: 'Estimate #', value: estimateNumber });
  if (estimateDate)   noteAttributes.push({ name: 'Estimate Date', value: estimateDate });
  if (clientName)     noteAttributes.push({ name: 'Client', value: clientName });

  // Build draft order payload
  const draftOrder = {
    draft_order: {
      line_items: lineItems,
      note: notes || '',
      note_attributes: noteAttributes,
      tags: 'SRF Estimate',
      ...(clientName && {
        shipping_address: { first_name: clientName, last_name: '' },
      }),
    },
  };

  try {
    const r = await fetch(`https://${store}/admin/api/2025-01/draft_orders.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify(draftOrder),
    });

    const data = await r.json();

    if (!r.ok) {
      console.error('Shopify draft order error:', data);
      return res.status(r.status).json({ error: data.errors || 'Shopify API error' });
    }

    const draft = data.draft_order;
    return res.status(200).json({
      id: draft.id,
      name: draft.name,
      adminUrl: `https://${store.replace('.myshopify.com', '')}.myshopify.com/admin/draft_orders/${draft.id}`,
      invoiceUrl: draft.invoice_url,
    });
  } catch (err) {
    console.error('Shopify proxy error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
