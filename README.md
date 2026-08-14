# Wayne County tax sale desk

React workbook for the public Treasurer auction, scored against Plottia.

Live: https://israelvaday.github.io/wayne-tax-sale/

## App structure

- **Overview** — auction calendar, match rate, score mix, cities
- **Inventory** — sortable deal table + Plottia sheet
- **Batches** — 56 close windows, click to filter

## Refresh data

```bash
npm run scrape
npm run enrich
node --use-system-ca scripts/fetch-catalog.mjs
npm run build
```

## Dev

```bash
npm install
npm run dev
```
