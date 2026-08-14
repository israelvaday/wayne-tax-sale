const PLOTTIA = 'https://plottia.com'

const state = {
  all: [],
  meta: null,
  filtered: [],
  selected: 0,
}

const $ = (id) => document.getElementById(id)

function money(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
}

function plottiaUrl(row) {
  const params = new URLSearchParams()
  if (row.parcelId) params.set('parcel', row.parcelId)
  const q = [row.address, row.city, 'MI', row.zip].filter(Boolean).join(', ')
  if (q) params.set('q', q)
  return `${PLOTTIA}/?${params}`
}

function mapsUrl(row) {
  const q = [row.address, row.city, 'MI', row.zip].filter(Boolean).join(', ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q || row.parcelId)}`
}

function matches(row, q, city, zip, structure) {
  if (city && row.city !== city) return false
  if (zip && row.zip !== zip) return false
  if (structure && row.structure !== structure) return false
  if (!q) return true
  const hay = [
    row.auctionId, row.parcelId, row.parcelKey, row.address, row.city, row.zip,
    row.legal, row.zoning, row.structure, row.itemStatus,
  ].join(' ').toLowerCase()
  return q.split(/\s+/).every((part) => hay.includes(part))
}

function applyFilters() {
  const q = $('q').value.trim().toLowerCase()
  const city = $('city').value
  const zip = $('zip').value
  const structure = $('structure').value
  const sort = $('sort').value
  const rows = state.all.filter((row) => matches(row, q, city, zip, structure))
  rows.sort((a, b) => {
    const av = a[sort] ?? ''
    const bv = b[sort] ?? ''
    if (typeof av === 'number' || typeof bv === 'number') return (Number(av) || 0) - (Number(bv) || 0)
    return String(av).localeCompare(String(bv))
  })
  state.filtered = rows
  if (state.selected >= rows.length) state.selected = Math.max(0, rows.length - 1)
  render()
}

function renderStats() {
  const m = state.meta || {}
  $('stats').innerHTML = `
    <span class="stat"><b>${state.filtered.length.toLocaleString()}</b> / ${state.all.length.toLocaleString()} parcels</span>
    <span class="stat"><b>${m.cities?.length || 0}</b> cities</span>
    <span class="stat">auction <b>${(m.auctionStarts || '').slice(0, 10) || '—'}</b></span>
  `
  $('scrapedAt').textContent = m.scrapedAt ? new Date(m.scrapedAt).toLocaleString() : 'unknown'
}

function renderTable() {
  const slice = state.filtered
  $('empty').hidden = slice.length > 0
  $('rows').innerHTML = slice.map((row, idx) => {
    const active = idx === state.selected ? 'active' : ''
    const occ = /OCCUPIED/i.test(row.structure || '') ? 'warn' : /VACANT|LAND/i.test(row.structure || '') ? 'ok' : ''
    return `<tr class="${active}" data-idx="${idx}">
      <td class="mono">${esc(row.auctionId)}</td>
      <td class="mono">${esc(row.parcelId)}</td>
      <td>${esc(row.address) || '<span class="muted">—</span>'}</td>
      <td>${esc(row.city)}</td>
      <td class="mono">${esc(row.zip)}</td>
      <td>${money(row.minBid)}</td>
      <td>${money(row.sev)}</td>
      <td><span class="pill ${occ}">${esc(row.structure || row.itemStatus || '—')}</span></td>
    </tr>`
  }).join('')
}

function renderDrawer() {
  const row = state.filtered[state.selected]
  if (!row) {
    $('drawer').innerHTML = '<p class="muted">Select a parcel to open details, Plottia, and the Treasurer page.</p>'
    return
  }
  $('drawer').innerHTML = `
    <div class="nav-btns">
      <button type="button" id="prevBtn">← Prev</button>
      <button type="button" id="nextBtn">Next →</button>
    </div>
    <h2>${esc(row.address || row.parcelId)}</h2>
    <div class="sub">${esc(row.city)}, MI ${esc(row.zip)} · ${state.selected + 1} of ${state.filtered.length}</div>
    <dl class="kv">
      <dt>Parcel</dt><dd class="mono">${esc(row.parcelId)}</dd>
      <dt>Auction id</dt><dd class="mono">${esc(row.auctionId)}</dd>
      <dt>Batch</dt><dd>${esc(row.batchId)} · ends ${esc((row.batchEnds || '').replace('T', ' ').slice(0, 16))}</dd>
      <dt>Min bid</dt><dd>${money(row.minBid)}</dd>
      <dt>SEV</dt><dd>${money(row.sev)}</dd>
      <dt>Summer tax</dt><dd>${money(row.summerTax)}</dd>
      <dt>Current bid</dt><dd>${row.currentBid == null ? 'none yet' : money(row.currentBid)} (${row.bidCount || 0} bids)</dd>
      <dt>Structure</dt><dd>${esc(row.structure || '—')}</dd>
      <dt>Zoning</dt><dd>${esc(row.zoning || '—')}</dd>
      <dt>Status</dt><dd>${esc(row.itemStatus || row.status || '—')}</dd>
      <dt>Legal</dt><dd>${esc(row.legal || '—')}</dd>
    </dl>
    <div class="actions">
      <a class="primary" id="openPlottia" href="${plottiaUrl(row)}" target="_blank" rel="noopener">Open in Plottia</a>
      <a class="gold" href="${esc(row.treasurerUrl)}" target="_blank" rel="noopener">Treasurer auction page</a>
      <a href="${mapsUrl(row)}" target="_blank" rel="noopener">Google Maps</a>
    </div>
  `
  $('prevBtn').onclick = () => move(-1)
  $('nextBtn').onclick = () => move(1)
}

function render() {
  renderStats()
  renderTable()
  renderDrawer()
  const row = state.filtered[state.selected]
  if (row) history.replaceState(null, '', `#${row.auctionId}`)
}

function select(idx) {
  if (!state.filtered.length) return
  state.selected = Math.max(0, Math.min(state.filtered.length - 1, idx))
  render()
  document.querySelector('tr.active')?.scrollIntoView({ block: 'nearest' })
}

function move(delta) {
  select(state.selected + delta)
}

function exportCsv() {
  const cols = ['auctionId', 'parcelId', 'address', 'city', 'zip', 'minBid', 'sev', 'summerTax', 'structure', 'zoning', 'legal', 'treasurerUrl']
  const lines = [cols.join(',')]
  for (const row of state.filtered) {
    lines.push(cols.map((c) => `"${String(row[c] ?? '').replace(/"/g, '""')}"`).join(','))
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'wayne-tax-sale.csv'
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
  fillSelect('city', meta.cities || [...new Set(props.map((p) => p.city))].sort())
  fillSelect('zip', meta.zips || [...new Set(props.map((p) => p.zip))].sort())
  fillSelect('structure', [...new Set(props.map((p) => p.structure).filter(Boolean))].sort())

  const hash = decodeURIComponent(location.hash.replace('#', ''))
  const hashIdx = props.findIndex((p) => p.auctionId === hash || p.parcelId === hash)
  if (hashIdx >= 0) state.selected = hashIdx

  $('q').addEventListener('input', applyFilters)
  $('city').addEventListener('change', applyFilters)
  $('zip').addEventListener('change', applyFilters)
  $('structure').addEventListener('change', applyFilters)
  $('sort').addEventListener('change', applyFilters)
  $('exportCsv').addEventListener('click', exportCsv)
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      $('sort').value = th.dataset.sort
      applyFilters()
    })
  })
  $('rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr')
    if (tr) select(Number(tr.dataset.idx))
  })
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
  applyFilters()
}

boot().catch((err) => {
  $('drawer').innerHTML = `<p class="muted">Failed to load snapshot: ${esc(err.message)}</p>`
})
