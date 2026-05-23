# Receipts

200+ merchants across India, USA, Canada, and the UK — auto-extracts line items from order pages into a local, encrypted ledger. Export to CSV/QuickBooks/Xero.

> Status: **v0.2.0** — scaffold + 200-merchant registry wired into manifest host_permissions. Extractors land one merchant per cron run.

## Coverage

| Country | Merchants |
|---|---|
| 🇮🇳 India | 51 |
| 🇺🇸 USA | 53 |
| 🇨🇦 Canada | 31 |
| 🇬🇧 UK | 65 |
| **Total** | **200** |

Categories: marketplace, fashion, beauty, grocery, quickcommerce, food, electronics, pharmacy, travel, books, pets, office, home, furniture, sports, alcohol.

Full registry: [`src/merchants.js`](src/merchants.js).

## Currencies

38 currencies supported with locale-aware formatting, robust parsing of merchant-page strings (handles US `$1,299.00`, EU `1.234,56 €`, INR `₹1,29,999`, JPY no-decimals, etc.), and pinned FX rates for offline conversion.

Full list: [`src/currency.js`](src/currency.js). Refresh rates on demand via `refreshRates()` (uses `open.er-api.com`, no key required).

## Install (dev)

```
git clone https://github.com/Sanjays2402/receipts.git
cd receipts
```

Then in Chrome: `chrome://extensions` → Developer mode → "Load unpacked" → select this folder.

## Permissions

- `storage`
- `activeTab`
- `scripting`
- `downloads`

**Host permissions:** 200 merchant origins (see manifest.json).

## Roadmap

See [ROADMAP.md](ROADMAP.md) — ~150 unchecked items. Agents ship one per 15-minute run.

## License

MIT — see [LICENSE](LICENSE).
