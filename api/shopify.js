// api/shopify.js — Create Shopify draft orders from SRF estimates (POST)
// and look up a draft by name for invoice generation (GET ?name=D12)
// Supabase project URL + public anon key (same values the browser app uses; not secrets)
const SUPABASE_URL  = process.env.SUPABASE_URL || 'https://clfetgikublcskfkrucq.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsZmV0Z2lrdWJsY3NrZmtydWNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTY4NDIsImV4cCI6MjA5MzY3Mjg0Mn0._QUVflkN5QExJq07JN77ZvBUYW3Aw_5rY6SBipx9QiE';

// Only signed-in app users may create drafts: verify their Supabase session token
async function isSignedIn(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: auth, apikey: SUPABASE_ANON },
    });
    return r.ok;
  } catch (err) {
    console.error('Supabase auth check failed:', err.message);
    return false;
  }
}

// Draft-order fields only — the token has draft-order scopes, not read_orders,
// so payment status isn't available; the app lets the user mark an invoice paid.
const MONEY = 'shopMoney { amount }';
const DRAFT_FIELDS = `
  name createdAt completedAt status note2
  customer { displayName email }
  billingAddress { name company address1 address2 city provinceCode zip }
  lineItems(first: 100) { nodes {
    title variantTitle quantity
    originalUnitPriceSet { ${MONEY} }
    originalTotalSet { ${MONEY} }
    discountedTotalSet { ${MONEY} }
  } }
  totalShippingPriceSet { ${MONEY} }
  totalTaxSet { ${MONEY} }
  totalPriceSet { ${MONEY} }
`;
const amt = (set) => parseFloat(set?.shopMoney?.amount || 0);

async function lookupDraft(store, token, rawName) {
  const name = String(rawName || '').trim().replace(/^#/, '').toUpperCase();
  if (!/^D\d+$/.test(name)) {
    throw Object.assign(new Error('Enter the Shopify draft number, e.g. D12.'), { status: 400 });
  }
  const wanted = `#${name}`;
  const r = await fetch(`https://${store}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({
      query: `query($q: String!) { draftOrders(first: 10, query: $q) { nodes { ${DRAFT_FIELDS} } } }`,
      variables: { q: wanted },
    }),
  });
  const data = await r.json();
  if (!r.ok || data.errors) {
    const msg = Array.isArray(data.errors) ? data.errors.map(e => e.message).join('; ') : (data.errors || `Shopify API error (${r.status})`);
    throw new Error(msg);
  }
  // Search is fuzzy — keep only the exact draft name
  const d = (data.data?.draftOrders?.nodes || []).find(n => n.name.toUpperCase() === wanted);
  if (!d) throw Object.assign(new Error(`Draft ${wanted} not found in Shopify.`), { status: 404 });

  return {
    name: d.name,
    completed: d.status === 'COMPLETED',
    date: (d.completedAt || d.createdAt || '').slice(0, 10),
    note: d.note2 || '',
    customer: d.customer ? { name: d.customer.displayName, email: d.customer.email } : null,
    billingAddress: d.billingAddress || null,
    lines: (d.lineItems?.nodes || []).map(li => ({
      title:        li.variantTitle ? `${li.title} — ${li.variantTitle}` : li.title,
      quantity:     li.quantity,
      unitPrice:    amt(li.originalUnitPriceSet),
      total:        amt(li.discountedTotalSet),
      lineDiscount: Math.max(0, amt(li.originalTotalSet) - amt(li.discountedTotalSet)),
    })),
    shipping: amt(d.totalShippingPriceSet),
    tax:      amt(d.totalTaxSet),
    total:    amt(d.totalPriceSet),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST' && req.method !== 'GET') { return res.status(405).json({ error: 'Method not allowed' }); }
  if (!(await isSignedIn(req))) {
    return res.status(401).json({ error: 'Not signed in — please sign in to the estimate tool again.' });
  }

  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  const store = process.env.SHOPIFY_STORE;
  if (!token || !store) {
    return res.status(500).json({ error: 'Shopify credentials not configured on server.' });
  }

  if (req.method === 'GET') {
    try {
      return res.status(200).json(await lookupDraft(store, token, req.query.name));
    } catch (err) {
      console.error('Shopify draft lookup error:', err.message);
      return res.status(err.status || 500).json({ error: err.message });
    }
  }

  const { items, clientName, estimateNumber, estimateDate, notes, discountAmount, discountType, discountValue, totals } = req.body;

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

  // Build discount for Shopify if one was applied
  let appliedDiscount = null;
  if (discountAmount && parseFloat(discountAmount) > 0) {
    if (discountType === 'percent' && discountValue) {
      appliedDiscount = {
        description: 'Estimate Discount',
        value_type: 'percentage',
        value: String(parseFloat(discountValue)),
        amount: String(parseFloat(discountAmount).toFixed(2)),
        title: `${discountValue}% Discount`,
      };
    } else if (discountType === 'fixed' && discountValue) {
      appliedDiscount = {
        description: 'Estimate Discount',
        value_type: 'fixed_amount',
        value: String(parseFloat(discountValue).toFixed(2)),
        amount: String(parseFloat(discountAmount).toFixed(2)),
        title: `$${parseFloat(discountValue).toFixed(2)} Discount`,
      };
    }
  }

  // Build draft order payload
  const draftOrder = {
    draft_order: {
      line_items: lineItems,
      note: notes || '',
      note_attributes: noteAttributes,
      tags: 'SRF Estimate',
      ...(appliedDiscount && { applied_discount: appliedDiscount }),
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
