# Wayne County tax sale desk

Temporary GitHub Pages workbook: public Treasurer auction list, matched to Plottia by parcel ID, then scored with AVM / rent / flip / cash-flow math.

Live: https://israelvaday.github.io/wayne-tax-sale/

Official bidding stays on [waynecountytreasurermi.com](https://waynecountytreasurermi.com/).

## Refresh

```bash
node --use-system-ca scripts/scrape.mjs
node scripts/enrich-plottia.mjs
```

`enrich-plottia.mjs` needs `DATABASE_URL` (reads `../../.env.local`).
