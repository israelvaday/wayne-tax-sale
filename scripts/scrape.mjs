/**
 * Pull the public Wayne County Treasurer auction list (same endpoints the
 * official search page uses) and write a static JSON snapshot for GH Pages.
 *
 * The X-API-KEY value is the public client key shipped in their frontend
 * config.js — not a private credential.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dir, '..')
const DATA = join(ROOT, 'data')

const API_URL = process.env.WAYNE_API_URL || 'https://waynecountytreasurermi.com/api'
const API_KEY = process.env.WAYNE_API_KEY || 'your-secret-api-key'
const DETAIL_CONCURRENCY = Number(process.env.DETAIL_CONCURRENCY || 6)
const TREASURER_BASE = 'https://waynecountytreasurermi.com'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function post(path, body, attempt = 1) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': API_KEY,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    if (attempt < 4 && (res.status === 429 || res.status >= 500)) {
      await sleep(400 * attempt)
      return post(path, body, attempt + 1)
    }
    throw new Error(`${path} HTTP ${res.status}`)
  }
  const data = await res.json()
  if (!data.bSuccess) {
    throw new Error(data.sErrorInfo || `${path} failed`)
  }
  if (data.oReturnObject == null || data.oReturnObject === '') return []
  return typeof data.oReturnObject === 'string'
    ? JSON.parse(data.oReturnObject)
    : data.oReturnObject
}

function normalizeParcel(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
}

function money(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return null
  return Number(n)
}

function mapSearchRow(row) {
  const parcelId = String(row.AI_PARCEL_ID || '').trim()
  const auctionId = String(row.AI_ID ?? '').trim()
  const batchId = row.AB_ID == null ? '' : String(row.AB_ID)
  return {
    auctionId,
    batchId,
    parcelId,
    parcelKey: normalizeParcel(parcelId),
    address: String(row.AI_ADDR || '').trim(),
    city: String(row.AI_CITY || '').trim(),
    zip: String(row.ZIP_CD || '').replace(/\D/g, '').slice(0, 5),
    minBid: money(row.AI_MIN_BID_AMT),
    status: String(row.STATUS_CD || '').trim(),
    bundleId: row.BUNDLE_AI_ID ? String(row.BUNDLE_AI_ID) : '',
    bidType: String(row.TYPE_OF_BID || '').trim(),
    batchEnds: row.AB_END_DT || null,
    treasurerUrl: `${TREASURER_BASE}/property-details.html?ai_id=${encodeURIComponent(auctionId)}&batchId=${encodeURIComponent(batchId || '1')}`,
  }
}

function mergeDetail(base, detail) {
  if (!detail) return base
  return {
    ...base,
    legal: String(detail.AI_LEGAL_DESC || '').trim(),
    sev: money(detail.AI_SEV),
    openingBid: money(detail.AI_OPENING_BID_AMT),
    minBid: money(detail.AI_MIN_BID_AMT) ?? base.minBid,
    summerTax: money(detail.SUMMER_TAX_AMT),
    zoning: String(detail.ZONING_DESC || '').trim(),
    structure: String(detail.STRUCTURE_DESC || '').trim(),
    itemStatus: String(detail.ITEM_STATUS || detail.STATUS || '').trim(),
    auctionStarts: detail.AUC_START_DT || null,
    batchEnds: detail.AB_END_DT || base.batchEnds,
    currentBid: money(detail.CURRENT_BID_AMT),
    bidCount: Number(detail.NO_OF_BIDS || 0) || 0,
    views: Number(detail.VIEW_CTR || 0) || 0,
    premium: String(detail.FOR_PREMIUM_BIDDER_IND || 'N') === 'Y',
    state: String(detail.AI_STATE_CD || 'MI').trim() || 'MI',
  }
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

async function main() {
  await mkdir(DATA, { recursive: true })

  const cities = (await post('/General/GetCityItemsCount', {})).map((c) =>
    String(c.AI_CITY || '').trim()
  ).filter(Boolean)
  const zips = (await post('/General/GetZipCityItemsCount', {})).map((z) =>
    String(z.ZIP_CITY || '').trim()
  ).filter(Boolean)

  console.log(`cities=${cities.length} zipCities=${zips.length}`)

  const byId = new Map()
  const empty = { ParcelID: '', AuctionItemID: '', StreetNbr: '', StreetAddress: '', City: '', Zip: '' }

  for (const city of cities) {
    const rows = await post('/General/SearchItems', { ...empty, City: city })
    for (const row of rows) {
      const mapped = mapSearchRow(row)
      if (mapped.auctionId) byId.set(mapped.auctionId, mapped)
    }
    console.log(`city ${city}: +${rows.length} (total ${byId.size})`)
    await sleep(80)
  }

  for (const zipCity of zips) {
    const rows = await post('/General/SearchItems', { ...empty, Zip: zipCity })
    let added = 0
    for (const row of rows) {
      const mapped = mapSearchRow(row)
      if (mapped.auctionId && !byId.has(mapped.auctionId)) {
        byId.set(mapped.auctionId, mapped)
        added++
      }
    }
    if (added) console.log(`zip ${zipCity}: +${added} (total ${byId.size})`)
    await sleep(80)
  }

  const list = [...byId.values()].sort((a, b) => a.auctionId.localeCompare(b.auctionId))
  console.log(`unique listings=${list.length}; fetching details…`)

  let detailsOk = 0
  let detailsFail = 0
  await mapPool(list, DETAIL_CONCURRENCY, async (item, idx) => {
    try {
      const rows = await post('/Items/GetAuctionItemDetails', { AI_ID: item.auctionId })
      const detail = Array.isArray(rows) ? rows[0] : rows
      Object.assign(item, mergeDetail(item, detail))
      detailsOk++
    } catch (err) {
      detailsFail++
      item.detailError = String(err.message || err)
    }
    if ((idx + 1) % 100 === 0 || idx + 1 === list.length) {
      console.log(`details ${idx + 1}/${list.length} ok=${detailsOk} fail=${detailsFail}`)
    }
    await sleep(40)
  })

  const citiesOut = [...new Set(list.map((p) => p.city).filter(Boolean))].sort()
  const zipsOut = [...new Set(list.map((p) => p.zip).filter(Boolean))].sort()

  const meta = {
    source: TREASURER_BASE,
    scrapedAt: new Date().toISOString(),
    count: list.length,
    detailsOk,
    detailsFail,
    cities: citiesOut,
    zips: zipsOut,
    auctionStarts: list.find((p) => p.auctionStarts)?.auctionStarts || null,
    auctionEnds: list.find((p) => p.batchEnds)?.batchEnds || null,
  }

  await writeFile(join(DATA, 'properties.json'), JSON.stringify(list))
  await writeFile(join(DATA, 'meta.json'), JSON.stringify(meta, null, 2))
  console.log(`wrote ${list.length} properties → data/properties.json`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
