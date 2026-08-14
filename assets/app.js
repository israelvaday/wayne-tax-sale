const PLOTTIA = 'https://plottia.com'
const ROW = 84

const PRESETS = [
  { id: 'best', label: 'Best overall', sort: 'score', dir: -1, extra: null },
  { id: 'flip', label: 'Best flips', sort: 'flipScore', dir: -1, extra: null },
  { id: 'rental', label: 'Best cash flow', sort: 'cashFlow', dir: -1, extra: null },
  { id: 'discount', label: 'Deepest discount', sort: 'discountPct', dir: -1, extra: null },
  { id: 'yield', label: 'Highest yield', sort: 'yieldPct', dir: -1, extra: null },
  { id: 'cheap', label: 'Cheap + matched', sort: 'minBid', dir: 1, extra: 'cheapMatched' },
  { id: 'vacant', label: 'Vacant value', sort: 'spread', dir: -1, extra: 'vacant' },
  { id: 'land', label: 'Land deals', sort: 'discountPct', dir: -1, extra: 'land' },
]

const state = {
  all: [],
  meta: null,
  filtered: [],
  selected: 0,
  preset: 'best',
}

const $ = (id) => document.getElementById(id)

function money(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function pct(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return `${Number(n).toFixed(1)}%`
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
}

function scoreClass(n) {
  if (n >= 70) return 'hot'
  if (n >= 40) return 'ok'
  return 'meh'
}

function plottiaUrl(row) {
  if (row.plottiaUrl) return row.plottiaUrl
  const params = new URLSearchParams()
  if (row.parcelId) params.set('parcel', row.parcelId)
  const q = [row.address, row.city, 'MI', row.zip].filter(Boolean).join(', ')
  if (q) params.set('q', q)
  return `${PLOTTIA}/?${params}`
}

function mapsUrl(row) {
  if (row.lat && row.lng) return `https://www.google.com/maps/?q=${row.lat},${row.lng}`
  const q = [row.address, row.city, 'MI', row.zip].filter(Boolean).join(', ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q || row.parcelId)}`
}

function sortValue(row, key) {
  if (key === 'flipScore') return row.flip?.score ?? -1
  if (key === 'cashFlow') return row.rental?.cashFlow ?? -99999
  if (key === 'yieldPct') return row.rental?.yieldPct ?? -1
  return row[key] ?? -1
}

function extraMatch(row, extra) {
  if (!extra) return true
  if (extra === 'cheapMatched') return !!row.plottiaId && (row.minBid || 0) <= 5000
  if (extra === 'vacant') return /VACANT/i.test(row.structure || '') && !/LAND/i.test(row.structure || '')
  if (extra === 'land') return /LAND/i.test(`${row.structure || ''} ${row.zoning || ''} ${row.landUse || ''}`)
  return true
}

function apply() {
  const q = $('q').value.trim().toLowerCase()
  const city = $('city').value
  const zip = $('zip').value
  const match = $('match').value
  const occ = $('occ').value
  const preset = PRESETS.find((p) => p.id === state.preset) || PRESETS[0]
  const selectedId = state.filtered[state.selected]?.auctionId

  const rows = state.all.filter((row) => {
    if (city && row.city !== city) return false
    if (zip && row.zip !== zip) return false
    if (match === 'plottia' && !row.plottiaId) return false
    if (match === 'unmatched' && row.plottiaId) return false
    if (occ === 'OCCUPIED' && !/OCCUPIED/i.test(row.structure || '')) return false
    if (occ === 'VACANT' && !/VACANT/i.test(row.structure || '')) return false
    if (occ === 'LAND' && !/LAND/i.test(`${row.structure || ''} ${row.zoning || ''} ${row.landUse || ''}`)) return false
    if (!extraMatch(row, preset.extra)) return false
    if (!q) return true
    const hay = [
      row.auctionId, row.parcelId, row.address, row.city, row.zip, row.legal,
      row.owner, row.structure, row.zoning, row.landUse,
    ].join(' ').toLowerCase()
    return q.split(/\s+/).every((part) => hay.includes(part))
  })

  rows.sort((a, b) => {
    const av = sortValue(a, preset.sort)
    const bv = sortValue(b, preset.sort)
    if (av === bv) return (b.score || 0) - (a.score || 0)
    return (av - bv) * preset.dir
  })

  state.filtered = rows
  const keep = selectedId ? rows.findIndex((r) => r.auctionId === selectedId) : 0
  state.selected = keep >= 0 ? keep : 0
  render()
}

function renderStats() {
  const m = state.meta || {}
  const matched = state.filtered.filter((r) => r.plottiaId).length
  $('stats').innerHTML = `
    <span class="stat"><b>${state.filtered.length.toLocaleString()}</b> showing</span>
    <span class="stat"><b>${matched.toLocaleString()}</b> Plottia hits</span>
    <span class="stat"><b>${m.matchRate ?? '—'}%</b> match rate</span>
  `
  $('scrapedAt').textContent = m.enrichedAt
    ? `Scored ${new Date(m.enrichedAt).toLocaleString()}`
    : (m.scrapedAt ? `Snapshot ${new Date(m.scrapedAt).toLocaleString()}` : '')
}

function renderPresets() {
  $('presets').innerHTML = PRESETS.map((p) =>
    `<button class="preset ${p.id === state.preset ? 'active' : ''}" data-id="${p.id}">${p.label}</button>`
  ).join('')
}

function cardHtml(row, idx) {
  const active = idx === state.selected ? 'active' : ''
  const spreadCls = (row.spread || 0) > 0 ? 'up' : 'down'
  return `<article class="card ${active}" data-idx="${idx}" style="height:${ROW - 6}px">
    <div class="score ${scoreClass(row.score || 0)}">${row.score || 0}</div>
    <div>
      <div class="addr">${esc(row.address || row.parcelId)}</div>
      <div class="sub">${esc(row.city)} ${esc(row.zip)} · ${esc(row.parcelId)}${row.plottiaId ? '' : ' · no Plottia match'}</div>
    </div>
    <div class="metric"><small>Min bid</small>${money(row.minBid)}</div>
    <div class="metric"><small>AVM ${row.avmSource === 'plottia' ? '' : row.avmSource === 'sev_x2' ? '(SEV×2)' : ''}</small>${money(row.avm)}</div>
    <div class="metric ${spreadCls}"><small>Spread</small>${money(row.spread)} · ${pct(row.discountPct)}</div>
    <div class="tags">
      <span class="tag ${/OCCUPIED/i.test(row.structure || '') ? 'warn' : 'good'}">${esc(row.structure || '—')}</span>
      ${row.rental ? `<span class="tag good">CF ${money(row.rental.cashFlow)}</span>` : ''}
    </div>
  </article>`
}

function renderFeed() {
  const feed = $('feed')
  const rows = state.filtered
  if (!rows.length) {
    feed.innerHTML = '<p class="muted" style="padding:24px">No parcels match this sort.</p>'
    return
  }
  const scroll = feed.scrollTop
  const view = feed.clientHeight || 600
  const start = Math.max(0, Math.floor(scroll / ROW) - 10)
  const end = Math.min(rows.length, Math.ceil((scroll + view) / ROW) + 10)
  const top = start * ROW
  const bottom = (rows.length - end) * ROW
  let html = `<div style="height:${top}px"></div>`
  for (let i = start; i < end; i++) html += cardHtml(rows[i], i)
  html += `<div style="height:${bottom}px"></div>`
  feed.innerHTML = html
}

function renderSheet() {
  const row = state.filtered[state.selected]
  if (!row) {
    $('sheet').innerHTML = '<p class="muted">Pick a parcel to see Plottia numbers and deal math.</p>'
    return
  }
  const flip = row.flip
  const rental = row.rental
  $('sheet').innerHTML = `
    <div class="nav">
      <button type="button" id="prevBtn">← Prev</button>
      <button type="button" id="nextBtn">Next →</button>
    </div>
    <h2>${esc(row.address || row.parcelId)}</h2>
    <div class="sub">${esc(row.city)}, MI ${esc(row.zip)} · ${state.selected + 1} / ${state.filtered.length}</div>
    <div class="bar"><i style="width:${Math.max(4, row.score || 0)}%"></i></div>
    <div class="grid">
      <div class="tile"><span>Deal score</span><b>${row.score || 0}</b></div>
      <div class="tile"><span>Min bid</span><b>${money(row.minBid)}</b></div>
      <div class="tile"><span>Plottia AVM</span><b>${money(row.avm)}</b></div>
      <div class="tile"><span>Spread</span><b class="${(row.spread || 0) > 0 ? 'up' : 'down'}">${money(row.spread)}</b></div>
      <div class="tile"><span>Discount</span><b>${pct(row.discountPct)}</b></div>
      <div class="tile"><span>SEV</span><b>${money(row.sev)}</b></div>
      <div class="tile"><span>Rent / mo</span><b>${money(row.rent)}</b></div>
      <div class="tile"><span>Cash flow</span><b class="${(rental?.cashFlow || 0) >= 0 ? 'up' : 'down'}">${rental ? money(rental.cashFlow) : '—'}</b></div>
    </div>
    <div class="grid">
      <div class="tile"><span>Flip @ likely bid</span><b>${flip ? `${flip.score} · ${money(flip.profit)}` : '—'}</b></div>
      <div class="tile"><span>Rental cap / CF</span><b>${rental ? `${pct(rental.capRate)} · ${money(rental.cashFlow)}` : '—'}</b></div>
      <div class="tile"><span>If stolen at opening</span><b>${row.stealFlip ? money(row.stealFlip.profit) : '—'}</b></div>
      <div class="tile"><span>Rehab guess</span><b>${money(row.rehab)} <small class="muted">${esc(row.rehabLevel || '')}</small></b></div>
    </div>
    <dl class="kv">
      <dt>Parcel</dt><dd class="mono">${esc(row.parcelId)}</dd>
      <dt>Auction</dt><dd class="mono">${esc(row.auctionId)} · batch ${esc(row.batchId)}</dd>
      <dt>Beds / baths</dt><dd>${row.beds ?? '—'} / ${row.baths ?? '—'} · ${row.sqft ? `${row.sqft.toLocaleString()} sf` : '—'}</dd>
      <dt>Year / lot</dt><dd>${row.yearBuilt || '—'} · ${row.lotSqft ? `${row.lotSqft.toLocaleString()} lot sf` : '—'}</dd>
      <dt>Owner</dt><dd>${esc(row.owner || '—')}${row.corporate ? ' · corporate' : ''}${row.distressed ? ' · distressed' : ''}</dd>
      <dt>Last sale</dt><dd>${row.lastSale != null ? money(row.lastSale) : '—'} ${row.lastSaleDate ? `· ${String(row.lastSaleDate).slice(0, 10)}` : ''}</dd>
      <dt>Summer tax</dt><dd>${money(row.summerTax)}</dd>
      <dt>Quality / stress bid</dt><dd>${row.quality ?? '—'} quality · rank bid ${money(row.stressBid)}</dd>
      <dt>70% max offer</dt><dd>${flip ? money(flip.maxOffer70) : '—'}${flip?.passes70 ? ' · passes' : ''}</dd>
      <dt>Match</dt><dd>${row.plottiaId ? `Plottia via ${esc(row.match)}` : 'SEV×2 fallback / no APN hit'}</dd>
      <dt>Legal</dt><dd>${esc(row.legal || '—')}</dd>
    </dl>
    <div class="actions">
      <a class="primary" href="${plottiaUrl(row)}" target="_blank" rel="noopener">Open in Plottia</a>
      <a class="gold" href="${esc(row.treasurerUrl)}" target="_blank" rel="noopener">Treasurer auction page</a>
      <a href="${mapsUrl(row)}" target="_blank" rel="noopener">Map</a>
    </div>
  `
  $('prevBtn').onclick = () => move(-1)
  $('nextBtn').onclick = () => move(1)
}

function render() {
  renderPresets()
  renderStats()
  renderFeed()
  renderSheet()
  const row = state.filtered[state.selected]
  if (row) history.replaceState(null, '', `#${row.auctionId}`)
}

function select(idx, scrollInto = false) {
  if (!state.filtered.length) return
  state.selected = Math.max(0, Math.min(state.filtered.length - 1, idx))
  render()
  if (scrollInto) {
    const top = state.selected * ROW - ($('feed').clientHeight / 2) + ROW
    $('feed').scrollTop = Math.max(0, top)
    renderFeed()
  }
}

function move(delta) {
  select(state.selected + delta, true)
}

function exportCsv() {
  const cols = [
    'score', 'auctionId', 'parcelId', 'address', 'city', 'zip', 'minBid', 'avm', 'spread',
    'discountPct', 'rent', 'rehab', 'structure', 'owner', 'plottiaUrl', 'treasurerUrl',
  ]
  const lines = [cols.join(',')]
  for (const row of state.filtered) {
    const view = {
      ...row,
      rent: row.rent ?? row.rental?.rent,
    }
    lines.push(cols.map((c) => `"${String(view[c] ?? '').replace(/"/g, '""')}"`).join(','))
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'wayne-tax-sale-scored.csv'
  a.click()
}

function fillSelect(id, values) {
  const el = $(id)
  for (const value of values) {
    const opt = document.createElement('option')
    opt.value = value
    opt.textContent = value
    el.appendChild(opt)
  }
}

async function boot() {
  const [props, meta] = await Promise.all([
    fetch('data/properties.json').then((r) => r.json()),
    fetch('data/meta.json').then((r) => r.json()),
  ])
  state.all = props
  state.meta = meta
  fillSelect('city', meta.cities || [])
  fillSelect('zip', meta.zips || [])

  const hash = decodeURIComponent(location.hash.replace('#', ''))
  $('presets').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-id]')
    if (!btn) return
    state.preset = btn.dataset.id
    apply()
  })
  $('q').addEventListener('input', apply)
  $('city').addEventListener('change', apply)
  $('zip').addEventListener('change', apply)
  $('match').addEventListener('change', apply)
  $('occ').addEventListener('change', apply)
  $('exportCsv').addEventListener('click', exportCsv)
  $('feed').addEventListener('click', (e) => {
    const card = e.target.closest('[data-idx]')
    if (card) select(Number(card.dataset.idx))
  })
  $('feed').addEventListener('scroll', () => renderFeed(), { passive: true })
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== $('q')) {
      e.preventDefault()
      $('q').focus()
      return
    }
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    if (e.key === 'Enter') {
      const row = state.filtered[state.selected]
      if (row) window.open(plottiaUrl(row), '_blank', 'noopener')
    }
    if (e.key === 't') {
      const row = state.filtered[state.selected]
      if (row) window.open(row.treasurerUrl, '_blank', 'noopener')
    }
    if (e.key === 'm') {
      const row = state.filtered[state.selected]
      if (row) window.open(mapsUrl(row), '_blank', 'noopener')
    }
  })
  apply()
  if (hash) {
    const idx = state.filtered.findIndex((p) => p.auctionId === hash || p.parcelId === hash)
    if (idx >= 0) select(idx, true)
  }
}

boot().catch((err) => {
  $('sheet').innerHTML = `<p class="muted">Failed to load snapshot: ${esc(err.message)}</p>`
})
