# SRF Estimate Tool

Pricing estimate generator for SRF Screen Printing & Apparel Decorating. Built as a single static HTML file — no server, no build step, no dependencies to install.

## Features

- Multi-item estimates with live calculations
- S&S Activewear garment pricing with $200 free-shipping threshold
- Three decoration types: Screen Printed Transfers, UCM Transfers, and Heat-Applied Patches
- 50% margin pricing (cost × 2)
- Client-facing PDF export (margin hidden from output)
- Brand-colored UI matching SRF logo

## Deploying to GitHub Pages

### Step 1 — Create a GitHub repository

1. Go to [github.com](https://github.com) and create a new repository (e.g. `srf-estimate`)
2. Make it **Public** (required for free GitHub Pages)

### Step 2 — Upload the file

**Option A — via GitHub web UI (simplest):**
1. Open your new repo and click **Add file → Upload files**
2. Drag `index.html` into the upload area
3. Click **Commit changes**

**Option B — via Git CLI:**
```bash
git init
git add index.html
git commit -m "Add SRF estimate tool"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/srf-estimate.git
git push -u origin main
```

### Step 3 — Enable GitHub Pages

1. In your repo, go to **Settings → Pages**
2. Under **Source**, select **Deploy from a branch**
3. Set branch to `main`, folder to `/ (root)`
4. Click **Save**

Your app will be live at:
```
https://YOUR_USERNAME.github.io/srf-estimate/
```

(GitHub Pages can take 1–2 minutes to go live after the first deploy.)

## Updating the app

Re-upload `index.html` via the GitHub web UI or push a new commit. GitHub Pages automatically redeploys on every push to `main`.

## Local testing

Open `index.html` directly in any modern browser — no server needed.

```bash
open index.html   # macOS
```

## Pricing logic reference

| Input | Source |
|-------|--------|
| Garment price / unit | Look up on [ssactivewear.com](https://ssactivewear.com) |
| Transfer price / unit | Look up on [transferexpress.com](https://transferexpress.com) |
| Patch price / unit | Look up on [stahlsusa.com](https://stahlsusa.com) |

| Decoration type | Flat shipping added |
|----------------|---------------------|
| Screen Printed Transfer | $15 |
| Ultra Color Max (UCM) | $15 |
| Heat-Applied Patch (Stahls) | $30 |

**Formula:**
```
Decoration cost/unit = (price/unit × qty + flat shipping) ÷ qty
Supplier shipping/unit = proportional share of S&S shipping ÷ qty
Total cost/unit = garment + decoration + supplier shipping
Sell price/unit = total cost/unit × 2   →  50% margin
```

S&S supplier shipping is **free** when the combined garment subtotal across all items reaches **$200**.
