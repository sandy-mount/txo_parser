import { html, render, onUnmount } from 'https://losos.org/losos/html.js'
import { parseTxoUri, isValidTxoUri, formatTxoUri } from '../../index.js'

export default {
  label: 'Parse',
  icon: '\uD83D\uDD0D',

  canHandle(subject, store) {
    var node = store.get(subject.value)
    var type = node && store.type(node)
    return type && (type.includes('TxoDemo') || type.includes('VoucherPool'))
  },

  render(subject, store, container) {
    var input = ''
    var result = null
    var error = null
    var valid = null

    var examples = [
      'txo:btc:4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb:0',
      'txo:btc:4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb:0?amount=0.75',
      'txo:btc:4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb:0?amount=1000&key=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      'txo:tbtc4:4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb:1?amount=50000&privkey=Kx9abc&script_type=p2tr',
      'txo:btc:4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb:0 0.75 Kx9abc'
    ]

    function doParse() {
      var el = container.querySelector('.txo-input')
      input = el ? el.value.trim() : ''
      if (!input) { result = null; error = null; valid = null; renderApp(); return }

      valid = isValidTxoUri(input)
      if (valid) {
        try {
          result = parseTxoUri(input)
          error = null
        } catch(e) {
          result = null
          error = e.message
        }
      } else {
        result = null
        error = 'Invalid TXO URI'
      }
      renderApp()
    }

    function loadExample(uri) {
      var el = container.querySelector('.txo-input')
      if (el) el.value = uri
      input = uri
      doParse()
    }

    function copyText(text) {
      navigator.clipboard.writeText(text)
    }

    function renderApp() {
      render(container, html`
        <style>
          .txo-wrap { padding: 0 16px 40px; }
          .txo-hero { text-align: center; padding: 40px 0 28px; }
          .txo-hero-icon { font-size: 3rem; margin-bottom: 8px; }
          .txo-hero-title { font-size: 1.6rem; font-weight: 800; margin-bottom: 4px; }
          .txo-hero-sub { font-size: 0.9rem; color: rgba(255,255,255,0.35); max-width: 500px; margin: 0 auto; }
          .txo-card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 24px; margin-bottom: 20px; backdrop-filter: blur(12px); }
          .txo-card h2 { font-size: 1rem; font-weight: 600; color: rgba(255,255,255,0.9); margin: 0 0 16px; }
          .txo-input { width: 100%; padding: 12px 16px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.9); font: 0.88rem 'SF Mono', 'Fira Code', monospace; outline: none; margin-bottom: 12px; }
          .txo-input::placeholder { color: rgba(255,255,255,0.2); font-family: -apple-system, sans-serif; }
          .txo-input:focus { border-color: rgba(59,130,246,0.5); }
          .txo-btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.8); font: 600 0.85rem -apple-system, sans-serif; cursor: pointer; transition: all 0.15s; }
          .txo-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
          .txo-btn-primary { background: linear-gradient(135deg, #3b82f6, #2563eb); border-color: rgba(59,130,246,0.4); color: #fff; }
          .txo-btn-sm { padding: 5px 10px; font-size: 0.75rem; border-radius: 6px; }
          .txo-examples { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
          .txo-example { padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.4); font-size: 0.72rem; cursor: pointer; font-family: 'SF Mono', monospace; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .txo-example:hover { background: rgba(59,130,246,0.1); border-color: rgba(59,130,246,0.3); color: rgba(255,255,255,0.7); }
          .txo-result { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 16px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.85rem; overflow-x: auto; }
          .txo-result-json { color: rgba(255,255,255,0.7); white-space: pre-wrap; line-height: 1.6; }
          .txo-result-key { color: #3b82f6; }
          .txo-result-str { color: #10b981; }
          .txo-result-num { color: #f7931a; }
          .txo-valid { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 6px; font-size: 0.78rem; font-weight: 600; margin-bottom: 12px; }
          .txo-valid-yes { background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.3); color: #10b981; }
          .txo-valid-no { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #ef4444; }
          .txo-anatomy { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; font-size: 0.82rem; margin-top: 14px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.06); }
          .txo-anatomy-label { color: rgba(255,255,255,0.3); font-weight: 600; }
          .txo-anatomy-val { color: rgba(255,255,255,0.7); font-family: 'SF Mono', monospace; word-break: break-all; cursor: pointer; }
          .txo-anatomy-val:hover { color: #fff; }
        </style>

        <div class="txo-wrap">
          <div class="txo-hero">
            <div class="txo-hero-icon">\uD83D\uDD0D</div>
            <div class="txo-hero-title">Parse TXO URI</div>
            <div class="txo-hero-sub">Paste a TXO URI to parse it into structured JSON. Try an example below.</div>
          </div>

          <div class="txo-card">
            <h2>Input</h2>
            <div class="txo-examples">
              ${examples.map(function(ex) {
                return html`<div class="txo-example" onclick="${function() { loadExample(ex) }}" title="${ex}">${ex.length > 40 ? ex.slice(0, 37) + '\u2026' : ex}</div>`
              })}
            </div>
            <input class="txo-input" placeholder="txo:btc:txid:vout?amount=N&privkey=K"
              oninput="${doParse}"
              onkeydown="${function(e) { if (e.key === 'Enter') doParse() }}" />

            ${valid !== null ? html`
              <div class="${'txo-valid ' + (valid ? 'txo-valid-yes' : 'txo-valid-no')}">
                ${valid ? '\u2713 Valid TXO URI' : '\u2716 Invalid'}
              </div>
            ` : null}
          </div>

          ${result ? html`
            <div class="txo-card">
              <h2>Parsed Result</h2>
              <div class="txo-result">
                <div class="txo-result-json">${formatJson(result)}</div>
              </div>

              <div class="txo-anatomy">
                <span class="txo-anatomy-label">Network</span>
                <span class="txo-anatomy-val" onclick="${function() { copyText(result.network) }}">${result.network}</span>
                <span class="txo-anatomy-label">TXID</span>
                <span class="txo-anatomy-val" onclick="${function() { copyText(result.txid) }}">${result.txid}</span>
                <span class="txo-anatomy-label">Output</span>
                <span class="txo-anatomy-val">${String(result.output)}</span>
                ${result.amount !== undefined ? html`
                  <span class="txo-anatomy-label">Amount</span>
                  <span class="txo-anatomy-val">${String(result.amount)}</span>
                ` : null}
                ${result.privkey ? html`
                  <span class="txo-anatomy-label">Privkey</span>
                  <span class="txo-anatomy-val" onclick="${function() { copyText(result.privkey) }}">${result.privkey.length > 20 ? result.privkey.slice(0, 8) + '\u2026' + result.privkey.slice(-8) : result.privkey}</span>
                ` : null}
                ${result.script_type ? html`
                  <span class="txo-anatomy-label">Script Type</span>
                  <span class="txo-anatomy-val">${result.script_type}</span>
                ` : null}
              </div>

              <div style="margin-top:14px;display:flex;gap:8px">
                <button class="txo-btn txo-btn-sm" onclick="${function() { copyText(JSON.stringify(result, null, 2)) }}">\u2398 Copy JSON</button>
                <button class="txo-btn txo-btn-sm" onclick="${function() { copyText(formatTxoUri(result)) }}">\uD83D\uDD17 Copy URI</button>
              </div>
            </div>
          ` : null}

          ${error && !result ? html`
            <div class="txo-card" style="border-color:rgba(239,68,68,0.2)">
              <div style="color:#ef4444;font-size:0.9rem">\u2716 ${error}</div>
            </div>
          ` : null}
        </div>
      `)
    }

    function formatJson(obj) {
      var json = JSON.stringify(obj, null, 2)
      return json
    }

    renderApp()
    onUnmount(container, function() {})
  }
}
