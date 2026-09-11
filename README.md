# Wayne County tax sale desk

React workbook for the public Treasurer auction, scored against Plottia.

Live: https://israelvaday.github.io/wayne-tax-sale/#options

## App structure

- **My options** — personal Wednesday bid book (quiet, high SEV, ACTIVE only)
- **Overview** — auction calendar, match rate, score mix, cities
- **Inventory** — sortable deal table + Plottia sheet
- **Batches** — close windows, click to filter

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
