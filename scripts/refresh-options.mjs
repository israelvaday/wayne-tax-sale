/**
 * Re-live-check every pick, pulled-off, and watching house
 * (STATUS, bids, views, close time). Writes both data/ copies.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const API_URL = process.env.WAYNE_API_URL || 'https://waynecountytreasurermi.com/api'
const API_KEY = process.env.WAYNE_API_KEY || 'your-secret-api-key'
const ROOT = process.cwd()

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function money(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return null
  return Number(n)
}

async function post(path, body, attempt = 1) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': API_KEY },
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
  if (!data.bSuccess) throw new Error(data.sErrorInfo || path)
  if (data.oReturnObject == null || data.oReturnObject === '') return []
  return typeof data.oReturnObject === 'string' ? JSON.parse(data.oReturnObject) : data.oReturnObject
}

async function findBook() {
  for (const rel of ['public/data/my-options.json', 'data/my-options.json']) {
    try {
      const path = join(ROOT, rel)
      const raw = await readFile(path, 'utf8')
      return { path, book: JSON.parse(raw) }
    } catch {
      // try next
    }
  }
  throw new Error('my-options.json not found')
}

function windowFor(batchId, end) {
  const n = Number(batchId) || 0
  const d = end ? new Date(end) : null
  const thu = d && !Number.isNaN(d.getTime()) && d.getDate() >= 17
  if (thu && n >= 32) return { id: 'thu', label: 'Thu leftover lots', order: 6 }
  if (n <= 8) return { id: 'early', label: 'Wed 9:15–11:00', order: 1 }
  if (n <= 14) return { id: 'lateam', label: 'Wed 11:15–12:30', order: 2 }
  if (n <= 20) return { id: 'lunch', label: 'Wed 12:45–2:00', order: 3 }
  if (n <= 26) return { id: 'afternoon', label: 'Wed 2:15–3:30', order: 4 }
  return { id: 'late', label: 'Wed 3:45–4:45', order: 5 }
}

function applyDetail(pick, d) {
  pick.saleStatus = String(d.STATUS || '').trim()
  pick.itemStatus = String(d.ITEM_STATUS || '').trim()
  pick.currentBid = money(d.CURRENT_BID_AMT)
  pick.bidCount = Number(d.NO_OF_BIDS || 0) || 0
  pick.views = Number(d.VIEW_CTR || 0) || 0
  pick.openingBid = money(d.AI_OPENING_BID_AMT) ?? pick.open
  pick.open = money(d.AI_OPENING_BID_AMT) ?? pick.open
  pick.sev = money(d.AI_SEV) ?? pick.sev
  pick.batchId = d.AB_ID == null ? pick.batchId : String(d.AB_ID)
  pick.batchEnds = d.AB_END_DT || pick.batchEnds
  pick.extendedEnd = d.EXTD_BIDDING_END_DT || null
  pick.lastBidAt = d.CURRENT_BID_DT || null
  const win = windowFor(pick.batchId, pick.batchEnds)
  pick.window = win.label
  pick.windowId = win.id
  pick.windowOrder = win.order
  pick.hot = !!(pick.currentBid && pick.sev && pick.currentBid > pick.sev * 0.45)
  delete pick.refreshError
}

async function refreshOne(pick) {
  const rows = await post('/Items/GetAuctionItemDetails', { AI_ID: pick.auctionId })
  const d = Array.isArray(rows) ? rows[0] : rows
  applyDetail(pick, d)
}

function uniq(rows) {
  const seen = new Set()
  return (rows || []).filter((r) => {
    if (!r?.auctionId || seen.has(r.auctionId)) return false
    seen.add(r.auctionId)
    return true
  })
}

const { book } = await findBook()
const bookRows = uniq([...(book.picks || []), ...(book.pulledOff || [])])
const watching = uniq(book.watching || [])
const all = uniq([...bookRows, ...watching])

let ok = 0
let fail = 0
for (const pick of all) {
  try {
    await refreshOne(pick)
    ok++
  } catch (err) {
    pick.refreshError = String(err.message || err)
    fail++
  }
  await sleep(40)
}

const pool = bookRows
const active = pool.filter((p) => p.saleStatus === 'ACTIVE')
const dead = pool.filter((p) => p.saleStatus && p.saleStatus !== 'ACTIVE')
active.sort((a, b) => (a.windowOrder || 0) - (b.windowOrder || 0) || Number(a.batchId) - Number(b.batchId))
book.pulled = new Date().toISOString()
book.picks = active
book.pulledOff = dead
book.watching = watching
book.counts = {
  checked: all.length,
  active: active.length,
  removed: dead.length,
  picked: active.length,
  watching: watching.length,
}

const payload = JSON.stringify(book, null, 2)
for (const rel of ['public/data/my-options.json', 'data/my-options.json']) {
  try {
    await writeFile(join(ROOT, rel), payload)
  } catch {
    // source or pages repo may only have one of these
  }
}

for (const rel of ['public/data/properties.json', 'data/properties.json']) {
  try {
    const listPath = join(ROOT, rel)
    const list = JSON.parse(await readFile(listPath, 'utf8'))
    const byId = new Map(all.map((p) => [String(p.auctionId), p]))
    let patched = 0
    for (const item of list) {
      const live = byId.get(String(item.auctionId))
      if (!live) continue
      item.auctionStatus = live.saleStatus
      item.itemStatus = live.itemStatus
      item.currentBid = live.currentBid
      item.bidCount = live.bidCount
      item.views = live.views
      item.openingBid = live.openingBid ?? item.openingBid
      item.batchId = live.batchId
      item.batchEnds = live.batchEnds
      item.lastBidAt = live.lastBidAt
      patched++
    }
    if (patched) await writeFile(listPath, JSON.stringify(list))
  } catch {
    // catalog not next to this book
  }
}

const gallagher = watching.find((p) => p.auctionId === '260900021')
console.log(`refreshed ok=${ok} fail=${fail} active=${active.length} removed=${dead.length} watching=${watching.length}`)
if (gallagher) {
  console.log(`gallagher bid=${gallagher.currentBid} bids=${gallagher.bidCount} views=${gallagher.views} status=${gallagher.saleStatus}`)
}
console.log(`pulled ${book.pulled}`)
