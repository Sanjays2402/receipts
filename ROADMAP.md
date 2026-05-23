# Roadmap

This file is the agent's task queue. Unchecked items get implemented in order. When all items are checked, the agent appends a new batch of 10.

- [x] MV3 manifest + content script scaffolding
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
