# Wayne County tax sale → Plottia

Temporary GitHub Pages workbook for the public Wayne County Treasurer auction list, with one-click jumps into Plottia by parcel ID.

Official bidding, deposits, and legal notices stay on [waynecountytreasurermi.com](https://waynecountytreasurermi.com/).

## Refresh the snapshot

```bash
node --use-system-ca scripts/scrape.mjs
```

Writes `data/properties.json` and `data/meta.json`.

## Local preview

```bash
npx --yes serve .
```

## Plottia deep links

Each row opens:

`https://plottia.com/?parcel={PARCEL_ID}&q={address}, {city}, MI {zip}`

That needs the Plottia `?parcel=` / `/api/search?apn=` support from this same change set.
