# Receipts

Auto-extract order info from Amazon, DoorDash, Uber, Flipkart and save to a local ledger.

> Status: **v0.1.0 — scaffold**. Features ship every 15 minutes via an autonomous agent. See `ROADMAP.md` for what's next.

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

**Host permissions:**
- `https://www.amazon.com/*`
- `https://www.amazon.in/*`
- `https://www.doordash.com/*`
- `https://www.ubereats.com/*`
- `https://www.flipkart.com/*`

## Roadmap

- [ ] MV3 manifest + content script scaffolding
- [ ] Detect order confirmation page on Amazon (US + IN)
- [ ] Detect order page on DoorDash, UberEats, Flipkart
- [ ] Extract line items: name, qty, price, total, date, order ID
- [ ] Store extracted receipts in IndexedDB
- [ ] Popup: list all captured receipts with search
- [ ] Filter by merchant, date range, category
- [ ] Auto-categorize (food, electronics, books, etc.)
- [ ] Export to CSV
- [ ] Export to QuickBooks/Xero JSON
- [ ] Monthly spend summary chart
- [ ] Manual entry form for non-supported sites
- [ ] Duplicate detection by order ID
- [ ] Liquid-glass popup UI
- [ ] Dark/light theme

## License

MIT — see [LICENSE](LICENSE).
