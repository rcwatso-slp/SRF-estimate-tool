// api/shopify.js — Create Shopify draft orders from SRF estimates (POST)
// and look up a draft/order by name for invoice generation (GET ?name=#D12 or ?name=1045)
const API_VERSION = '2025-01';

const MONEY = 'shopMoney { amount }';
const ADDRESS = 'name company address1 address2 city provinceCode zip country phone';
const LINE_ITEMS = `lineItems(first: 100) { nodes {
  title variantTitle quantity
  originalUnitPriceSet { ${MONEY} }
  originalTotalSet { ${MONEY} }
  discountedTotalSet { ${MONEY} }
} }`;

const ORDER_FIELDS = `
  id name createdAt processedAt note displayFinancialStatus
  customer { displayName email }
  billingAddress { ${ADDRESS} }
  shippingAddress { ${ADDRESS} }
  ${LINE_ITEMS}
  subtotalPriceSet { ${MONEY} }
  totalDiscountsSet { ${MONEY} }
  totalShippingPriceSet { ${MONEY} }
  totalTaxSet { ${MONEY} }
  totalPriceSet { ${MONEY} }
  totalReceivedSet { ${MONEY} }
  totalOutstandingSet { ${MONEY} }
`;

const DRAFT_FIELDS = `
  id name createdAt completedAt status note2
  customer { displayName email }
  billingAddress { ${ADDRESS} }
  shippingAddress { ${ADDRESS} }
  ${LINE_ITEMS}
  subtotalPriceSet { ${MONEY} }
  totalDiscountsSet { ${MONEY} }
  totalShippingPriceSet { ${MONEY} }
  totalTaxSet { ${MONEY} }
  totalPriceSet { ${MONEY} }
  order { ${ORDER_FIELDS} }
`;

async function shopifyGql(store, token, query, variables) {
  const r = await fetch(`https://${store}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const data = await r.json();
  if (!r.ok || data.errors) {
    const msg = Array.isArray(data.errors) ? data.errors.map(e => e.message).join('; ') : (data.errors || `Shopify API error (${r.status})`);
    throw new Error(msg);
  }
  return data.data;
}

const amt = (set) => parseFloat(set?.shopMoney?.amount || 0);

// Normalize a draft or order into one invoice shape the client can render
function toInvoice(src, kind, draftName) {
  const lines = (src.lineItems?.nodes || []).map(li => ({
    title:     li.variantTitle ? `${li.title} — ${li.variantTitle}` : li.title,
    quantity:  li.quantity,
    unitPrice: amt(li.originalUnitPriceSet),
    total:     amt(li.discountedTotalSet),
    lineDiscount: Math.max(0, amt(li.originalTotalSet) - amt(li.discountedTotalSet)),
  }));
  const total = amt(src.totalPriceSet);
  const isOrder = kind === 'order';
  return {
    kind,
    name: src.name,
    draftName: draftName || (kind === 'draft' ? src.name : ''),
    date: (isOrder ? (src.processedAt || src.createdAt) : (src.completedAt || src.createdAt) || '').slice(0, 10),
    financialStatus: isOrder ? src.displayFinancialStatus : (src.status === 'COMPLETED' ? 'PENDING' : 'UNPAID'),
    note: isOrder ? src.note : src.note2,
    customer: src.customer ? { name: src.customer.displayName, email: src.customer.email } : null,
    billingAddress: src.billingAddress || null,
    shippingAddress: src.shippingAddress || null,
    lines,
    subtotal: amt(src.subtotalPriceSet),
    discounts: amt(src.totalDiscountsSet),
    shipping: amt(src.totalShippingPriceSet),
    tax: amt(src.totalTaxSet),
    total,
    paid: isOrder ? amt(src.totalReceivedSet) : 0,
    balanceDue: isOrder ? amt(src.totalOutstandingSet) : total,
  };
}

async function lookupInvoice(store, token, rawName) {
  const name = String(rawName || '').trim().replace(/^#/, '');
  if (!name) throw Object.assign(new Error('Enter a Shopify order or draft number.'), { status: 400 });
  const isDraft = /^d\d+$/i.test(name);

  if (isDraft) {
    const wanted = `#${name.toUpperCase()}`;
    const query = (fields) => `query($q: String!) { draftOrders(first: 10, query: $q) { nodes { ${fields} } } }`;
    let data;
    try {
      data = await shopifyGql(store, token, query(DRAFT_FIELDS), { q: wanted });
    } catch (err) {
      // Token may lack read_orders scope — retry without the completed-order fields
      data = await shopifyGql(store, token, query(DRAFT_FIELDS.replace(/order \{[\s\S]*\}\s*$/, '')), { q: wanted });
    }
    const draft = data.draftOrders.nodes.find(d => d.name.toUpperCase() === wanted);
    if (!draft) throw Object.assign(new Error(`Draft ${wanted} not found in Shopify.`), { status: 404 });
    // Prefer the real order once the draft has been completed (has payment status)
    return draft.order ? toInvoice(draft.order, 'order', draft.name) : toInvoice(draft, 'draft');
  }

  const data = await shopifyGql(store, token,
    `query($q: String!) { orders(first: 10, query: $q) { nodes { ${ORDER_FIELDS} } } }`,
    { q: `name:#${name}` });
  const order = data.orders.nodes.find(o => o.name.replace(/^#/, '') === name);
  if (!order) throw Object.assign(new Error(`Order #${name} not found in Shopify.`), { status: 404 });
  return toInvoice(order, 'order');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST' && req.method !== 'GET') { return res.status(405).json({ error: 'Method not allowed' }); }

  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  const store = process.env.SHOPIFY_STORE;
  if (!token || !store) {
    return res.status(500).json({ error: 'Shopify credentials not configured on server.' });
  }

  if (req.method === 'GET') {
    try {
      return res.status(200).json(await lookupInvoice(store, token, req.query.name));
    } catch (err) {
      console.error('Shopify invoice lookup error:', err.message);
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
