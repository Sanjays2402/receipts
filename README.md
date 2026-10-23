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

## Implemented extractors

24 of 200 merchants have working DOM extractors (status `supported` in
the registry); the rest are scaffolded for one-per-run landing:

- 🇮🇳 Amazon India, Flipkart, Myntra, Ajio, Meesho, Tata CLiQ, Nykaa,
  BigBasket, Blinkit, Zepto, Swiggy, Zomato, **Snapdeal**
- 🇺🇸 Amazon US, Walmart, Target, DoorDash, Instacart, Uber Eats
- 🇬🇧 Amazon UK, Deliveroo
- 🇨🇦 Amazon CA, Best Buy CA, Costco

Each extractor exposes `matches(url)` and `extract(doc, ctx)` returning
a canonical partial receipt (`merchantId`, ISO `date`, `total`,
currency, line `items`); `src/extractor.js` validates and normalizes the
result. Unit tests live in `tests/extractors/<merchant>.test.mjs` and
run as part of `npm test`.

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

## Terms & Disclaimer

By using this project you agree to the following.

- **No warranty.** This software is provided "as is", without warranty of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement.
- **No liability.** To the maximum extent permitted by law, the author and contributors are not liable for any claim, loss, or damage (direct, indirect, incidental, or consequential, including lost data or profits) arising from its use.
- **Your responsibility.** You use it at your own risk and are responsible for complying with the laws that apply to you.
- **Your data.** Keep backups; data loss is possible. If you process other people's personal information, you are responsible for complying with privacy laws such as US state privacy laws (e.g. CCPA), PIPEDA and Quebec's Law 25 (Canada), and the Digital Personal Data Protection Act, 2023 (India).
- **Not tax or accounting advice.** Extracted amounts can be wrong; check them against the original receipt before using them for taxes, expense claims, or bookkeeping. Merchant names are trademarks of their owners.
- **Third parties.** Names, logos, APIs, and services of others belong to their owners and are used for identification only; no affiliation or endorsement is implied.
- **Your statutory rights.** Nothing here limits rights that cannot be waived by agreement, including under consumer-protection laws in the USA, Canada (including Quebec), and India (Consumer Protection Act, 2019).
- **License.** Use, copying, and distribution are governed by the [LICENSE](LICENSE) file; if anything here conflicts with it, the license controls.
