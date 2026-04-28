# SRF Estimate Tool

Pricing estimate generator for SRF Screen Printing & Apparel Decorating. Built as a single static HTML file — no server, no build step, no dependencies to install.

## Features

- Multi-item estimates with live calculations
- S&S Activewear garment pricing with $200 free-shipping threshold
- Three decoration types: Screen Printed Transfers, UCM Transfers, and Heat-Applied Patches
- Adjustable target margin, defaulting to 50% margin (cost × 2)
- Client-facing PDF export (margin hidden from output)
- Brand-colored UI matching SRF logo

## Public deployment note

This app is safe to host publicly as long as `index.html` does not contain private pricing rules, vendor credentials, employee/customer data, API keys, or unpublished artwork files. The app runs entirely in the browser and does not store submitted estimates on a server.

Before publishing, review:

- Target margin defaults and pricing assumptions
- Supplier/free-shipping thresholds
- Embedded logo/brand assets
- Any text that should not be public

## Deploying to GitHub Pages

This repo is prepared for GitHub Pages with GitHub Actions. The workflow publishes only `index.html` from a temporary `_site` folder, so local design/source files are not deployed.

### Step 1 — Create or choose a GitHub repository

Create a repository on GitHub, then connect this local project to it:

```bash
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/srf-estimate.git
git push -u origin main
```

If a remote already exists, use this instead:

```bash
git remote set-url origin https://github.com/YOUR_USERNAME/srf-estimate.git
git push -u origin main
```

### Step 2 — Enable GitHub Pages

1. In the GitHub repo, go to **Settings → Pages**
2. Under **Build and deployment**, set **Source** to **GitHub Actions**
3. Push to `main` or manually run **Deploy GitHub Pages** from the Actions tab

Your app will be live at:

```
https://YOUR_USERNAME.github.io/srf-estimate/
```

(GitHub Pages can take 1–2 minutes to go live after the first deploy.)

## Updating the app

Commit changes and push to `main`. GitHub Actions will publish the updated `index.html` automatically.

## Local testing

Open `index.html` directly in any modern browser — no server needed.

```bash
open index.html   # macOS
```

## Pricing logic reference

| Input | Source |
|-------|--------|
| Garment price / unit | Look up on [ssactivewear.com](https://ssactivewear.com) |
| Total transfer price for the item | Look up/order total on [transferexpress.com](https://transferexpress.com) |
| Patch price / unit | Look up on [stahlsusa.com](https://stahlsusa.com) |

| Decoration type | Flat shipping added |
|----------------|---------------------|
| Screen Printed Transfer | $15 |
| Ultra Color Max (UCM) | $15 |
| Heat-Applied Patch (Stahls) | $30 |

**Formula:**
```
Transfer decoration cost/unit = (total transfer price + flat shipping) ÷ qty
Patch decoration cost/unit = (patch price/unit × qty + flat shipping) ÷ qty
Supplier shipping/unit = proportional share of S&S shipping ÷ qty
Total cost/unit = garment + decoration + supplier shipping
Sell price/unit = total cost/unit ÷ (1 - target margin %)   →  defaults to ×2 at 50% margin
```

S&S supplier shipping is **free** when the combined garment subtotal across all items reaches **$200**.
