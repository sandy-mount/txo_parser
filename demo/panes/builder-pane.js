import { html, render, onUnmount } from 'https://losos.org/losos/html.js'
import { formatTxoUri, parseTxoUri } from '../../index.js'

export default {
  label: 'Build',
  icon: '\uD83D\uDEE0',

  canHandle(subject, store) {
    var node = store.get(subject.value)
    var type = node && store.type(node)
    return type && (type.includes('TxoDemo') || type.includes('VoucherPool'))
  },

  render(subject, store, container) {
    var network = 'btc'
    var txid = ''
    var output = '0'
    var amount = ''
    var privkey = ''
    var scriptType = ''
    var result = null
    var error = null

    var networks = [
      { code: 'btc', name: 'Bitcoin' },
      { code: 'tbtc4', name: 'Testnet 4' },
      { code: 'tbtc3', name: 'Testnet 3' },
      { code: 'ltc', name: 'Litecoin' },
      { code: 'liq', name: 'Liquid' }
    ]

    function copyText(text) {
      navigator.clipboard.writeText(text)
      var t = document.createElement('div')
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(59,130,246,0.9);color:#fff;padding:8px 20px;border-radius:8px;font-size:0.85rem;font-weight:600;z-index:999;animation:v-fade 0.3s'
      t.textContent = 'Copied!'
      document.body.appendChild(t)
      setTimeout(function() { t.remove() }, 1500)
    }

    function readFields() {
      var el = function(cls) { return container.querySelector('.' + cls) }
      network = (el('b-network') && el('b-network').value) || 'btc'
      txid = (el('b-txid') && el('b-txid').value.trim()) || ''
      output = (el('b-output') && el('b-output').value.trim()) || '0'
      amount = (el('b-amount') && el('b-amount').value.trim()) || ''
      privkey = (el('b-privkey') && el('b-privkey').value.trim()) || ''
      scriptType = (el('b-script') && el('b-script').value.trim()) || ''
    }

    function buildUri() {
      readFields()
      error = null
      result = null

      if (!txid) { error = 'TXID is required'; renderApp(); return }

      var data = {
        network: network,
        txid: txid.toLowerCase(),
        output: parseInt(output) || 0
      }
      if (amount) data.amount = parseFloat(amount) || parseInt(amount) || amount
      if (privkey) data.privkey = privkey
      if (scriptType) data.script_type = scriptType

      try {
        result = formatTxoUri(data)
        error = null
      } catch(e) {
        error = e.message
        result = null
      }
      renderApp()
    }

    function randomTxid() {
      var hex = ''
      for (var i = 0; i < 64; i++) hex += '0123456789abcdef'[Math.floor(Math.random() * 16)]
      var el = container.querySelector('.b-txid')
      if (el) el.value = hex
      txid = hex
    }

    function renderApp() {
      render(container, html`
        <style>
          .b-wrap { padding: 0 16px 40px; }
          .b-hero { text-align: center; padding: 40px 0 28px; }
          .b-hero-icon { font-size: 3rem; margin-bottom: 8px; }
          .b-hero-title { font-size: 1.6rem; font-weight: 800; margin-bottom: 4px; }
          .b-hero-sub { font-size: 0.9rem; color: rgba(255,255,255,0.35); }
          .b-card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 24px; margin-bottom: 20px; }
          .b-card h2 { font-size: 1rem; font-weight: 600; margin: 0 0 16px; }
          .b-field { margin-bottom: 14px; }
          .b-label { font-size: 0.78rem; color: rgba(255,255,255,0.4); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
          .b-input { width: 100%; padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.9); font: 0.88rem 'SF Mono', monospace; outline: none; }
          .b-input:focus { border-color: rgba(59,130,246,0.5); }
          .b-input::placeholder { color: rgba(255,255,255,0.2); }
          .b-select { padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.9); font: 0.88rem -apple-system, sans-serif; outline: none; width: 100%; }
          .b-row { display: flex; gap: 12px; }
          .b-row > * { flex: 1; }
          .b-btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.8); font: 600 0.85rem -apple-system, sans-serif; cursor: pointer; transition: all 0.15s; }
          .b-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
          .b-btn-primary { background: linear-gradient(135deg, #3b82f6, #2563eb); border-color: rgba(59,130,246,0.4); color: #fff; }
          .b-btn-sm { padding: 5px 10px; font-size: 0.78rem; border-radius: 6px; }
          .b-result { background: rgba(16,185,129,0.06); border: 1px solid rgba(16,185,129,0.2); border-radius: 10px; padding: 16px; margin-top: 16px; }
          .b-result-uri { font-family: 'SF Mono', monospace; font-size: 0.85rem; color: #10b981; word-break: break-all; line-height: 1.5; margin-bottom: 10px; }
          .b-error { background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); border-radius: 10px; padding: 14px; color: #ef4444; font-size: 0.85rem; margin-top: 16px; }
          .b-hint { font-size: 0.72rem; color: rgba(255,255,255,0.2); margin-top: 4px; }
          @media (max-width: 600px) { .b-row { flex-direction: column; } }
        </style>

        <div class="b-wrap">
          <div class="b-hero">
            <div class="b-hero-icon">\uD83D\uDEE0</div>
            <div class="b-hero-title">Build TXO URI</div>
            <div class="b-hero-sub">Construct a TXO URI from individual fields</div>
          </div>

          <div class="b-card">
            <h2>Fields</h2>

            <div class="b-row">
              <div class="b-field">
                <div class="b-label">Network</div>
                <select class="b-select b-network" onchange="${buildUri}">
                  ${networks.map(function(n) {
                    return html`<option value="${n.code}" selected="${n.code === network ? true : false}">${n.name} (${n.code})</option>`
                  })}
                </select>
              </div>
              <div class="b-field" style="flex:0.4">
                <div class="b-label">Output Index</div>
                <input class="b-input b-output" value="${output}" type="number" min="0"
                  oninput="${buildUri}" />
              </div>
            </div>

            <div class="b-field">
              <div class="b-label" style="display:flex;justify-content:space-between;align-items:center">
                TXID
                <button class="b-btn b-btn-sm" onclick="${function() { randomTxid(); buildUri() }}">\uD83C\uDFB2 Random</button>
              </div>
              <input class="b-input b-txid" placeholder="64-character hex transaction ID" value="${txid}"
                oninput="${buildUri}" />
            </div>

            <div class="b-row">
              <div class="b-field">
                <div class="b-label">Amount <span style="font-weight:400;text-transform:none">(optional)</span></div>
                <input class="b-input b-amount" placeholder="e.g. 0.75 or 50000" value="${amount}"
                  oninput="${buildUri}" />
              </div>
              <div class="b-field">
                <div class="b-label">Script Type <span style="font-weight:400;text-transform:none">(optional)</span></div>
                <input class="b-input b-script" placeholder="e.g. p2tr" value="${scriptType}"
                  oninput="${buildUri}" />
              </div>
            </div>

            <div class="b-field">
              <div class="b-label">Private Key <span style="font-weight:400;text-transform:none">(optional, keep secure!)</span></div>
              <input class="b-input b-privkey" placeholder="WIF or hex key" value="${privkey}"
                oninput="${buildUri}" />
              <div class="b-hint">\u26A0 Including a private key makes this URI spend-ready. Share only over secure channels.</div>
            </div>

            <button class="b-btn b-btn-primary" onclick="${buildUri}">\uD83D\uDEE0 Build URI</button>

            ${result ? html`
              <div class="b-result">
                <div class="b-result-uri">${result}</div>
                <div style="display:flex;gap:8px">
                  <button class="b-btn b-btn-sm" onclick="${function() { copyText(result) }}">\u2398 Copy</button>
                  <button class="b-btn b-btn-sm" onclick="${function() { copyText(JSON.stringify(parseTxoUri(result), null, 2)) }}">\u2398 Copy JSON</button>
                </div>
              </div>
            ` : null}

            ${error ? html`<div class="b-error">\u2716 ${error}</div>` : null}
          </div>
        </div>
      `)
    }

    renderApp()
    onUnmount(container, function() {})
  }
}
