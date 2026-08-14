/**
 * Match Wayne tax-sale parcels to Plottia Postgres and attach AVM / rent /
 * owner / deal scores. Reads DATABASE_URL from realmaker .env.local.
 * Never writes secrets into the snapshot.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dir, '..')
const REPO = join(ROOT, '..', '..')

try {
  process.loadEnvFile(join(REPO, '.env.local'))
} catch {
  // DATABASE_URL may already be in the environment
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing — set it or add .env.local')
  process.exit(1)
}

function normParcel(value) {
  return String(value || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
}

function apnCandidates(raw) {
  const input = String(raw || '').trim()
  if (!input) return []
  const alnum = normParcel(input)
  const set = new Set([input, input.replace(/\.+$/, ''), alnum])
  if (alnum) set.add(`${alnum}.`)
  if (/^\d{8}$/.test(alnum)) {
    set.add(alnum)
    set.add(`${alnum}.`)
  }
  if (/^\d{14}$/.test(alnum)) {
    set.add(`${alnum.slice(0, 2)} ${alnum.slice(2, 5)} ${alnum.slice(5, 7)} ${alnum.slice(7, 11)} ${alnum.slice(11)}`)
  }
  return [...set].filter(Boolean)
}

function normStreet(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function houseAndRoute(address) {
  const line = normStreet(address)
  const m = line.match(/^(\d+)\s+(.*)$/)
  if (!m) return { house: '', route: line }
  return { house: m[1], route: m[2] }
}

function money(n) {
  const v = Number(n)
  return Number.isFinite(v) ? v : null
}

function slugifyPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function plottiaPath(row) {
  if (!row.id) return null
  const state = slugifyPart(row.state || 'MI').slice(0, 2)
  const city = slugifyPart(row.city) || 'unknown'
  const zip5 = String(row.postal_code || '').replace(/\D/g, '').slice(0, 5)
  const street = slugifyPart(row.street)
  const slug = zip5 ? `${street}-${zip5}` : street || 'property'
  return `/property/${state}/${city}/${slug}-${row.id}`
}

function rehabGuess(item, livingArea) {
  const sqft = Number(livingArea) || 0
  const structure = String(item.structure || '').toUpperCase()
  if (/VACANT LAND|LAND ONLY|VACANT LOT/.test(structure) || /LAND/.test(item.zoning || '') && !sqft) {
    return { rehab: 0, level: 'None', note: 'land / no living area' }
  }
  if (/VACANT/.test(structure)) {
    const rehab = sqft ? Math.round(sqft * 45) : 25000
    return { rehab, level: 'Heavy', note: 'vacant structure' }
  }
  if (/OCCUPIED/.test(structure)) {
    const rehab = sqft ? Math.round(sqft * 20) : 12000
    return { rehab, level: 'Light', note: 'occupied' }
  }
  const rehab = sqft ? Math.round(sqft * 30) : 18000
  return { rehab, level: 'Medium', note: 'unknown occupancy' }
}

function scoreFlip({ purchase, rehab, arv }) {
  if (!purchase || !arv) return null
  const closingBuy = purchase * 0.025
  const closingSell = arv * 0.08
  const holding = purchase * 0.0154 * 0.5 + 150 * 6
  const total = purchase + rehab + closingBuy + closingSell + holding
  const profit = arv - total
  const roi = total > 0 ? (profit / total) * 100 : 0
  const maxOffer70 = arv * 0.7 - rehab
  const passes70 = purchase <= maxOffer70 && maxOffer70 > 0
  let pts = 0
  if (roi >= 25) pts += 50
  else if (roi >= 15) pts += 35 + ((roi - 15) / 10) * 15
  else if (roi >= 8) pts += 20 + ((roi - 8) / 7) * 15
  else if (roi >= 0) pts += (roi / 8) * 20
  if (profit >= 40000) pts += 30
  else if (profit >= 20000) pts += 18 + ((profit - 20000) / 20000) * 12
  else if (profit >= 10000) pts += 10 + ((profit - 10000) / 10000) * 8
  else if (profit >= 0) pts += (profit / 10000) * 10
  if (passes70) pts += 20
  return {
    profit: Math.round(profit),
    roi: Math.round(roi * 10) / 10,
    maxOffer70: Math.round(maxOffer70),
    passes70,
    score: Math.round(Math.max(0, Math.min(100, pts))),
  }
}

function scoreRental({ purchase, rehab, rent, annualTax }) {
  if (!purchase || !rent) return null
  const vacancy = rent * 0.08
  const repairs = rent * 0.1
  const capex = rent * 0.08
  const tax = (annualTax || purchase * 0.0154) / 12
  const insurance = (purchase * 0.004) / 12
  const opex = vacancy + repairs + capex + tax + insurance
  const noi = rent - opex
  const down = purchase * 0.25
  const loan = purchase - down
  const r = 0.075 / 12
  const n = 360
  const pi = loan > 0 ? loan * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) : 0
  const cf = noi - pi
  const cashIn = down + rehab + purchase * 0.025
  const cap = purchase + rehab > 0 ? ((noi * 12) / (purchase + rehab)) * 100 : 0
  const coc = cashIn > 0 ? ((cf * 12) / cashIn) * 100 : 0
  const dscr = pi > 0 ? (noi * 12) / (pi * 12) : 0
  const yieldPct = (rent * 12 / purchase) * 100
  let pts = 0
  if (cap >= 10) pts += 35
  else if (cap >= 6) pts += 20 + ((cap - 6) / 4) * 15
  else if (cap > 0) pts += (cap / 6) * 20
  if (cf >= 300) pts += 35
  else if (cf >= 100) pts += 18 + ((cf - 100) / 200) * 17
  else if (cf >= 0) pts += (cf / 100) * 18
  if (rent >= (purchase + rehab) * 0.01) pts += 15
  if (coc >= 10) pts += 15
  else if (coc > 0) pts += (coc / 10) * 15
  return {
    rent: Math.round(rent),
    cashFlow: Math.round(cf),
    capRate: Math.round(cap * 10) / 10,
    cashOnCash: Math.round(coc * 10) / 10,
    dscr: Math.round(dscr * 100) / 100,
    yieldPct: Math.round(yieldPct * 10) / 10,
    score: Math.round(Math.max(0, Math.min(100, pts))),
  }
}

function qualityScore(item, plottia, avm, rent, living) {
  let q = 40
  const structure = String(item.structure || '').toUpperCase()
  if (/OCCUPIED/.test(structure)) q += 18
  if (/VACANT/.test(structure) && !/LAND/.test(structure)) q -= 12
  if (/LAND/.test(`${structure} ${item.zoning || ''} ${plottia?.zoning_desc || ''}`)) q -= 8
  if (plottia?.id) q += 8
  if ((avm || 0) >= 120000) q += 12
  else if ((avm || 0) >= 60000) q += 7
  else if ((avm || 0) > 0 && avm < 25000) q -= 8
  if ((rent || 0) >= 1200) q += 12
  else if ((rent || 0) >= 800) q += 7
  if ((living || 0) >= 1000) q += 6
  else if (!living) q -= 6
  if (plottia?.is_distressed) q -= 4
  return Math.round(Math.max(0, Math.min(100, q)))
}

function attachScores(item, plottia) {
  const minBid = money(item.minBid)
  const sev = money(item.sev)
  const avm = money(plottia?.market_value) || (sev ? sev * 2 : null)
  const avmSource = money(plottia?.market_value) ? 'plottia' : sev ? 'sev_x2' : null
  const rent = money(plottia?.rental_estimate)
  const living = money(plottia?.living_area)
  const { rehab, level, note } = rehabGuess(item, living)
  const stealBid = minBid
  // Opening bids are tiny; rank as if you have to compete toward ~25% of AVM / SEV.
  const stressBid = Math.max(
    stealBid || 0,
    sev || 0,
    avm ? Math.round(avm * 0.25) : 0
  ) || stealBid
  const stealFlip = stealBid && avm ? scoreFlip({ purchase: stealBid, rehab, arv: avm }) : null
  const flip = stressBid && avm ? scoreFlip({ purchase: stressBid, rehab, arv: avm }) : null
  const rental = stressBid && rent ? scoreRental({
    purchase: stressBid,
    rehab,
    rent,
    annualTax: money(item.summerTax) ? money(item.summerTax) * 2 : null,
  }) : null
  const stealRental = stealBid && rent ? scoreRental({
    purchase: stealBid,
    rehab,
    rent,
    annualTax: money(item.summerTax) ? money(item.summerTax) * 2 : null,
  }) : null

  const spread = stealBid && avm ? Math.round(avm - stealBid) : null
  const discountPct = stealBid && avm ? Math.round(((avm - stealBid) / avm) * 1000) / 10 : null
  const quality = qualityScore(item, plottia, avm, rent, living)
  const composite = Math.round(
    quality * 0.34 +
    (flip?.score || 0) * 0.38 +
    (rental?.score || 0) * 0.28
  )

  return {
    ...item,
    match: plottia ? (plottia._match || 'apn') : null,
    plottiaId: plottia?.id || null,
    plottiaUrl: plottia ? `https://plottia.com${plottiaPath(plottia)}` : item.parcelId
      ? `https://plottia.com/?parcel=${encodeURIComponent(item.parcelId)}`
      : 'https://plottia.com/',
    avm,
    avmSource,
    rent,
    beds: money(plottia?.beds),
    baths: money(plottia?.baths),
    sqft: living,
    lotSqft: money(plottia?.lot_size),
    yearBuilt: money(plottia?.year_constructed),
    owner: [plottia?.owner_first, plottia?.owner_last].filter(Boolean).join(' ') || null,
    corporate: !!plottia?.is_corporate,
    distressed: !!plottia?.is_distressed,
    lastSale: plottia?.last_sale_price != null ? Number(plottia.last_sale_price) : null,
    lastSaleDate: plottia?.last_sale_date || null,
    lat: money(plottia?.lat),
    lng: money(plottia?.lng),
    landUse: plottia?.zoning_desc || item.zoning || null,
    rehab,
    rehabLevel: level,
    rehabNote: note,
    spread,
    discountPct,
    stressBid,
    quality,
    stealFlip,
    stealRental,
    flip,
    rental,
    score: composite,
  }
}

const SELECT = `
  SELECT
    realmaker_id::text AS id,
    apn AS parcel_number,
    street_address AS street,
    city,
    state,
    zip5 AS postal_code,
    lat,
    lng,
    beds,
    baths,
    COALESCE(NULLIF(living_area, 0), NULLIF(living_sqft, 0)) AS living_area,
    COALESCE(NULLIF(lot_area, 0), NULLIF(lot_sqft, 0)) AS lot_size,
    year_built AS year_constructed,
    last_sale_date,
    last_sale_price,
    avm_value AS market_value,
    rent_estimate AS rental_estimate,
    owner1_first AS owner_first,
    owner1_last AS owner_last,
    COALESCE(owner1_is_corporate, false) AS is_corporate,
    COALESCE(is_distressed, false) AS is_distressed,
    land_use AS zoning_desc
  FROM properties
`

function plottiaFromRow(item) {
  if (!item.plottiaId) return null
  const ownerParts = String(item.owner || '').split(/\s+/).filter(Boolean)
  return {
    id: item.plottiaId,
    _match: item.match,
    market_value: item.avmSource === 'plottia' ? item.avm : null,
    rental_estimate: item.rent,
    living_area: item.sqft,
    lot_size: item.lotSqft,
    beds: item.beds,
    baths: item.baths,
    year_constructed: item.yearBuilt,
    owner_first: ownerParts[0] || null,
    owner_last: ownerParts.slice(1).join(' ') || null,
    is_corporate: item.corporate,
    is_distressed: item.distressed,
    last_sale_price: item.lastSale,
    last_sale_date: item.lastSaleDate,
    lat: item.lat,
    lng: item.lng,
    zoning_desc: item.landUse,
    street: item.address,
    city: item.city,
    state: 'MI',
    postal_code: item.zip,
  }
}

async function writeSnapshot(list, meta, extraMeta) {
  const matched = list.filter((p) => p.plottiaId).length
  const scored = list.filter((p) => p.score > 0).length
  const nextMeta = {
    ...meta,
    enrichedAt: new Date().toISOString(),
    matched,
    matchRate: Math.round((matched / list.length) * 1000) / 10,
    scored,
    ...extraMeta,
  }
  await writeFile(join(ROOT, 'data', 'properties.json'), JSON.stringify(list))
  await writeFile(join(ROOT, 'data', 'meta.json'), JSON.stringify(nextMeta, null, 2))
  console.log(`matched=${matched}/${list.length} (${nextMeta.matchRate}%) scored=${scored}`)
}

async function main() {
  const list = JSON.parse(await readFile(join(ROOT, 'data', 'properties.json'), 'utf8'))
  const meta = JSON.parse(await readFile(join(ROOT, 'data', 'meta.json'), 'utf8'))

  if (process.argv.includes('--rescore')) {
    const enriched = list.map((item) => attachScores(item, plottiaFromRow(item)))
    await writeSnapshot(enriched, meta, {})
    return
  }
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 4,
  })

  const candidateToAuction = new Map()
  for (const item of list) {
    for (const c of apnCandidates(item.parcelId)) {
      if (!candidateToAuction.has(c)) candidateToAuction.set(c, [])
      candidateToAuction.get(c).push(item.auctionId)
    }
  }

  const candidates = [...candidateToAuction.keys()]
  const byAuction = new Map()
  console.log(`tax-sale=${list.length} apn-candidates=${candidates.length}`)

  for (let i = 0; i < candidates.length; i += 400) {
    const chunk = candidates.slice(i, i + 400)
    const r = await pool.query(`${SELECT} WHERE apn = ANY($1::text[])`, [chunk])
    for (const row of r.rows) {
      const ids = new Set([
        ...(candidateToAuction.get(row.parcel_number) || []),
        ...(candidateToAuction.get(normParcel(row.parcel_number)) || []),
        ...(candidateToAuction.get(`${normParcel(row.parcel_number)}.`) || []),
      ])
      for (const auctionId of ids) {
        if (!byAuction.has(auctionId)) byAuction.set(auctionId, { ...row, _match: 'apn' })
      }
    }
    console.log(`apn batch ${Math.min(i + 400, candidates.length)}/${candidates.length} hits=${r.rowCount} matched=${byAuction.size}`)
  }

  const unmatched = list.filter((p) => !byAuction.has(p.auctionId) && p.address && p.zip)
  console.log(`unmatched after APN=${unmatched.length}; trying address+zip`)

  let addrHits = 0
  for (let i = 0; i < unmatched.length; i += 1) {
    const item = unmatched[i]
    const { house, route } = houseAndRoute(item.address)
    if (!house || !route || route.length < 3) continue
    const r = await pool.query(
      `
      ${SELECT}
      WHERE state = 'MI'
        AND zip5 = $1
        AND street_address ILIKE $2
      ORDER BY CASE WHEN city ILIKE $3 THEN 0 ELSE 1 END
      LIMIT 1
      `,
      [item.zip, `${house} ${route.split(' ')[0]}%`, item.city]
    )
    if (r.rows[0]) {
      byAuction.set(item.auctionId, { ...r.rows[0], _match: 'address' })
      addrHits++
    }
    if ((i + 1) % 100 === 0) console.log(`address ${i + 1}/${unmatched.length} extra=${addrHits}`)
  }

  await pool.end()

  const enriched = list.map((item) => attachScores(item, byAuction.get(item.auctionId) || null))
  await writeSnapshot(enriched, meta, {
    apnMatches: [...byAuction.values()].filter((r) => r._match === 'apn').length,
    addressMatches: addrHits,
  })
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
