import { html, render, keyed, onUnmount } from 'https://losos.org/losos/html.js'
import { parseVoucherFromItem, buildTxoUri } from '../lib/bitcoin.js'

export default {
  label: 'Faucet',
  icon: '\uD83D\uDEB0',

  canHandle(subject, store) {
    var node = store.get(subject.value)
    if (!node) return false
    var type = store.type(node)
    return type && type.includes('VoucherPool')
  },

  render(subject, lionStore, container, rawData) {

    // ── Load state ──────────────────────────────────────

    var data = rawData || {}
    var items = data['schema:itemListElement'] || []
    var allVouchers = items.map(parseVoucherFromItem)

    // Only show dispensable vouchers: unspent + has key
    var available = allVouchers.filter(function(v) {
      return v.privkey && v.status === 'unspent'
    })

    // ── Helpers ─────────────────────────────────────────

    function toast(msg) {
      var t = document.createElement('div')
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(16,185,129,0.9);color:#fff;padding:8px 20px;border-radius:8px;font-size:0.85rem;font-weight:600;z-index:999;animation:v-fade 0.3s'
      t.textContent = msg
      document.body.appendChild(t)
      setTimeout(function() { t.remove() }, 2000)
    }

    function copyText(text) {
      navigator.clipboard.writeText(text).then(function() { toast('Copied to clipboard') })
    }

    function truncate(s, start, end) {
      start = start || 8; end = end || 6
      if (!s || s.length <= start + end + 3) return s
      return s.slice(0, start) + '\u2026' + s.slice(-end)
    }

    function satsBtc(sats) { return (sats / 1e8).toFixed(8) }

    function faucetLink(v) {
      return location.origin + location.pathname + '?key=' + v.privkey
    }

    // ── Render ──────────────────────────────────────────

    var totalSats = available.reduce(function(s, v) { return s + (v.amount || 0) }, 0)

    render(container, html`
      <style>
        .f-wrap { padding: 0 16px 40px; }
        .f-hero { text-align: center; padding: 40px 0 32px; }
        .f-hero-icon { font-size: 3rem; margin-bottom: 8px; }
        .f-hero-title { font-size: 1.6rem; font-weight: 800; margin-bottom: 4px; }
        .f-hero-sub { font-size: 0.9rem; color: rgba(255,255,255,0.35); }
        .f-stats { display: flex; gap: 16px; justify-content: center; margin-bottom: 32px; flex-wrap: wrap; }
        .f-stat { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 14px 24px; text-align: center; }
        .f-stat-val { font-size: 1.5rem; font-weight: 700; color: #10b981; }
        .f-stat-label { font-size: 0.7rem; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; }
        .f-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
        .f-card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 24px; backdrop-filter: blur(12px); transition: all 0.2s; }
        .f-card:hover { background: rgba(255,255,255,0.08); border-color: rgba(124,58,237,0.3); }
        .f-card-amount { font-size: 1.8rem; font-weight: 800; margin-bottom: 4px; }
        .f-card-amount small { font-size: 0.4em; color: rgba(255,255,255,0.35); }
        .f-card-btc { font-size: 0.82rem; color: rgba(255,255,255,0.3); margin-bottom: 16px; }
        .f-card-txid { font-size: 0.75rem; color: rgba(255,255,255,0.25); font-family: 'SF Mono', 'Fira Code', monospace; margin-bottom: 16px; }
        .f-card-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .f-btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.8); font: 600 0.82rem -apple-system, sans-serif; cursor: pointer; transition: all 0.15s; }
        .f-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
        .f-btn-primary { background: linear-gradient(135deg, #7c3aed, #6d28d9); border-color: rgba(124,58,237,0.4); color: #fff; box-shadow: 0 4px 16px rgba(124,58,237,0.2); flex: 1; justify-content: center; }
        .f-btn-primary:hover { box-shadow: 0 6px 24px rgba(124,58,237,0.3); }
        .f-empty { text-align: center; padding: 48px 24px; color: rgba(255,255,255,0.25); }
        .f-empty-icon { font-size: 3rem; margin-bottom: 12px; }
        .f-empty-text { font-size: 0.95rem; font-style: italic; }
      </style>

      <div class="f-wrap">
        <div class="f-hero">
          <div class="f-hero-icon">\uD83D\uDEB0</div>
          <div class="f-hero-title">Testnet4 Faucet</div>
          <div class="f-hero-sub">Dispense vouchers for testing</div>
        </div>

        <div class="f-stats">
          <div class="f-stat">
            <div class="f-stat-val">${String(available.length)}</div>
            <div class="f-stat-label">Available</div>
          </div>
          <div class="f-stat">
            <div class="f-stat-val">${totalSats.toLocaleString()}</div>
            <div class="f-stat-label">Total sats</div>
          </div>
        </div>

        ${available.length === 0 ? html`
          <div class="f-empty">
            <div class="f-empty-icon">\uD83C\uDFDC\uFE0F</div>
            <div class="f-empty-text">No vouchers available to dispense.<br/>Import some in the Vouchers tab first.</div>
          </div>
        ` : null}

        <div class="f-grid">
          ${keyed(available, function(v) { return v.id }, function(v) {
            return html`
              <div class="f-card">
                <div class="f-card-amount">${(v.amount || 0).toLocaleString()} ${html`<small>sats</small>`}</div>
                <div class="f-card-btc">${satsBtc(v.amount || 0)} tBTC</div>
                <div class="f-card-txid">${truncate(v.txid)}:${String(v.vout)}</div>
                <div class="f-card-actions">
                  <button class="f-btn f-btn-primary"
                    onclick="${function() { copyText(faucetLink(v)) }}">
                    \uD83D\uDD17 Copy Faucet Link
                  </button>
                  <button class="f-btn" title="Copy TXO URI"
                    onclick="${function() { copyText(buildTxoUri(v)) }}">
                    \u2398
                  </button>
                </div>
              </div>
            `
          })}
        </div>
      </div>
    `)

    onUnmount(container, function() {})
  }
}
