import { html, render, keyed, onUnmount } from 'https://losos.org/losos/html.js'
import { Blocktrail, verify } from 'https://esm.sh/blocktrails@0.0.11'
import {
  decodeKey, bytesToHex, hexToU8, sha256,
  buildTransaction, estimateVsize, fetchUtxos, fetchTxDetails, broadcastTx, getFeeRate,
  wpToP2trAddress, parseVoucherFromItem, hexToBytes
} from '../lib/bitcoin.js'

export default {
  label: 'Ledger',
  icon: '\uD83D\uDCCA',

  canHandle(subject, store) {
    var node = store.get(subject.value)
    if (!node) return false
    var type = store.type(node)
    return type && type.includes('VoucherPool')
  },

  render(subject, lionStore, container, rawData) {

    // ── URLs ────────────────────────────────────────────

    var LEDGER_URL = new URL('webledger.jsonld', location.href).href
    var TRAIL_URL = new URL('blocktrail.jsonld', location.href).href
    var HISTORY_URL = new URL('ledger-history.jsonld', location.href).href

    // ── State ───────────────────────────────────────────

    var ledger = null
    var trail = null
    var privkeyHex = ''
    var history = []
    var saving = false
    var error = null
    var editingEntry = null // index being edited, or 'new'

    // ── Load data ───────────────────────────────────────

    var loaded = 0
    var totalLoads = 3

    function checkReady() {
      loaded++
      if (loaded >= totalLoads) renderApp()
    }

    // Load ledger
    fetch(LEDGER_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function(r) { return r.ok ? r.json() : null })
      .then(function(data) {
        if (data) ledger = data
        else ledger = { '@context': 'https://w3id.org/webledgers', '@id': '#this', type: 'WebLedger', name: 'Voucher Pool Ledger', defaultCurrency: 'satoshi', entries: [] }
        checkReady()
      })
      .catch(function() { ledger = { '@context': 'https://w3id.org/webledgers', '@id': '#this', type: 'WebLedger', name: 'Voucher Pool Ledger', defaultCurrency: 'satoshi', entries: [] }; checkReady() })

    // Load trail
    fetch(TRAIL_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function(r) { return r.ok ? r.json() : null })
      .then(function(data) {
        if (data && data['bt:privkey']) {
          try {
            privkeyHex = data['bt:privkey']
            trail = new Blocktrail(privkeyHex)
            var stateNodes = data['bt:state'] || []
            if (!Array.isArray(stateNodes)) stateNodes = [stateNodes]
            stateNodes.forEach(function(n) {
              var val = typeof n === 'string' ? n : (n['bt:value'] || '')
              if (val) {
                if (trail.states.length === 0) trail.genesis(val)
                else trail.advance(val)
              }
            })
          } catch(e) { console.warn('Trail load error:', e) }
        }
        checkReady()
      })
      .catch(function() { checkReady() })

    // Load history
    fetch(HISTORY_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function(r) { return r.ok ? r.json() : null })
      .then(function(data) {
        if (data && data['bt:snapshots']) {
          history = Array.isArray(data['bt:snapshots']) ? data['bt:snapshots'] : [data['bt:snapshots']]
        }
        checkReady()
      })
      .catch(function() { checkReady() })

    // ── Helpers ─────────────────────────────────────────

    function toast(msg) {
      var t = document.createElement('div')
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(59,130,246,0.9);color:#fff;padding:8px 20px;border-radius:8px;font-size:0.85rem;font-weight:600;z-index:999;animation:v-fade 0.3s'
      t.textContent = msg
      document.body.appendChild(t)
      setTimeout(function() { t.remove() }, 2000)
    }

    function copyText(text) {
      navigator.clipboard.writeText(text).then(function() { toast('Copied') })
    }

    function truncate(s, start, end) {
      start = start || 8; end = end || 6
      if (!s || s.length <= start + end + 3) return s
      return s.slice(0, start) + '\u2026' + s.slice(-end)
    }

    async function hashContent(content) {
      var str = typeof content === 'string' ? content : JSON.stringify(content)
      var hash = await sha256(str)
      return bytesToHex(hash)
    }

    // ── Ledger operations ───────────────────────────────

    function addEntry() {
      var urlInput = container.querySelector('.wl-new-url')
      var amountInput = container.querySelector('.wl-new-amount')
      var url = urlInput && urlInput.value.trim()
      var amount = amountInput && amountInput.value.trim()
      if (!url || !amount) { toast('Enter URL and amount'); return }

      if (!ledger.entries) ledger.entries = []
      ledger.entries.push({ type: 'Entry', url: url, amount: amount })
      editingEntry = null
      renderApp()
    }

    function removeEntry(index) {
      ledger.entries.splice(index, 1)
      renderApp()
    }

    function updateEntry(index) {
      var urlInput = container.querySelector('.wl-edit-url')
      var amountInput = container.querySelector('.wl-edit-amount')
      var url = urlInput && urlInput.value.trim()
      var amount = amountInput && amountInput.value.trim()
      if (!url || !amount) return
      ledger.entries[index] = { type: 'Entry', url: url, amount: amount }
      editingEntry = null
      renderApp()
    }

    // ── Verify ───────────────────────────────────────────

    var verifyResult = null
    var verifying = false

    async function verifyLedger() {
      if (verifying) return
      verifying = true
      verifyResult = { running: true }
      renderApp()

      try {
        // 1. Hash current ledger
        var currentHash = await hashContent(JSON.stringify(ledger, null, 2))
        verifyResult.currentHash = currentHash

        // 2. Get latest state from trail
        if (!trail || trail.states.length === 0) {
          verifyResult = { running: false, status: 'no-trail', message: 'No blocktrail configured. Anchor the ledger first.' }
          verifying = false; renderApp(); return
        }

        var latestState = trail.states[trail.states.length - 1]
        verifyResult.anchoredHash = latestState

        await new Promise(function(r) { setTimeout(r, 400) })

        // 3. Compare
        var hashMatch = currentHash === latestState
        verifyResult.hashMatch = hashMatch

        // 4. Verify the full blocktrail chain
        if (hashMatch) {
          await new Promise(function(r) { setTimeout(r, 300) })
          var exp = trail.export()
          var wpBytes = exp.witnessPrograms.map(function(wp) { return hexToU8(wp) })
          var chainResult = verify(exp.pubkeyBase, exp.states, wpBytes)
          verifyResult.chainValid = chainResult.valid
          verifyResult.chainError = chainResult.error
        }

        // 5. Check if latest state is on-chain
        if (hashMatch && verifyResult.chainValid) {
          await new Promise(function(r) { setTimeout(r, 300) })
          try {
            var exp = trail.export()
            var latestWp = exp.witnessPrograms[exp.witnessPrograms.length - 1]
            var addr = wpToP2trAddress(latestWp, true)
            var utxos = await fetchUtxos(addr)
            verifyResult.onChain = utxos.length > 0
            if (utxos.length > 0) {
              verifyResult.txid = utxos[0].txid
              verifyResult.confirmed = utxos[0].status && utxos[0].status.confirmed
            }
          } catch(e) {
            verifyResult.onChain = null // couldn't check
          }
        }

        verifyResult.running = false
        verifyResult.status = hashMatch && verifyResult.chainValid ? 'valid' : hashMatch ? 'chain-broken' : 'modified'
      } catch(e) {
        verifyResult = { running: false, status: 'error', message: e.message }
      }
      verifying = false
      renderApp()
    }

    // ── Save + Anchor ───────────────────────────────────

    async function saveLedger(andAnchor) {
      if (saving) return
      saving = true
      error = null
      renderApp()

      try {
        // 1. Save ledger
        var ledgerJson = JSON.stringify(ledger, null, 2)
        await fetch(LEDGER_URL, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/ld+json' },
          body: ledgerJson
        })

        if (!andAnchor) {
          toast('Ledger saved')
          saving = false
          renderApp()
          return
        }

        // 2. Hash the ledger content
        var contentHash = await hashContent(ledgerJson)

        // 3. Snapshot to history
        var snapshot = {
          '@type': 'bt:Snapshot',
          'bt:contentHash': 'sha256:' + contentHash,
          'bt:timestamp': new Date().toISOString(),
          'bt:content': JSON.parse(ledgerJson)
        }
        history.push(snapshot)
        await fetch(HISTORY_URL, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/ld+json' },
          body: JSON.stringify({
            '@context': { 'schema': 'https://schema.org/', 'bt': 'https://blocktrails.org/ns/' },
            '@id': '#this',
            '@type': 'bt:History',
            'bt:snapshots': history
          }, null, 2)
        })

        // 4. Advance blocktrail with the hash as state
        if (!trail || !privkeyHex) {
          toast('Saved + snapshot. No blocktrail configured \u2014 go to Blocktrails tab to initialize.')
          saving = false
          renderApp()
          return
        }

        var stateValue = contentHash
        if (trail.states.length === 0) {
          trail.genesis(stateValue)
        } else {
          trail.advance(stateValue)
        }

        // 5. Try to broadcast on-chain
        var exp = trail.export()
        var currentIdx = trail.states.length - 1
        var prevIdx = currentIdx - 1
        var newWp = exp.witnessPrograms[currentIdx]
        var newAddr = wpToP2trAddress(newWp, true)
        var txid = null

        if (prevIdx >= 0) {
          // Spend from previous state
          var prevAddr = wpToP2trAddress(exp.witnessPrograms[prevIdx], true)
          try {
            var utxos = await fetchUtxos(prevAddr)
            if (utxos.length > 0) {
              var utxo = utxos[0]
              var prevStates = trail.states.slice(0, currentIdx)
              var signingKeyHex = null
              if (prevIdx === 0) {
                var g = (await import('https://esm.sh/blocktrails@0.0.11')).genesis
                signingKeyHex = g(hexToBytes(privkeyHex), trail.states[0]).derivedPrivkey
              } else {
                var tr = (await import('https://esm.sh/blocktrails@0.0.11')).transition
                signingKeyHex = tr(hexToBytes(privkeyHex), trail.states.slice(0, prevIdx), trail.states[prevIdx]).signingPrivkey
              }

              var txDetails = await fetchTxDetails(utxo.txid)
              var prevOut = txDetails.vout[utxo.vout]
              var inputScript = hexToU8(prevOut.scriptpubkey)

              var outputScript = new Uint8Array(34)
              outputScript[0] = 0x51; outputScript[1] = 0x20
              outputScript.set(hexToU8(newWp), 2)

              var feeRate = await getFeeRate()
              var fee = Math.ceil(estimateVsize(1, 1) * feeRate)
              var outputAmount = utxo.value - fee
              if (outputAmount > 546) {
                var rawTx = await buildTransaction(
                  [{ txid: utxo.txid, vout: utxo.vout, amount: utxo.value, scriptPubKey: inputScript }],
                  [{ amount: outputAmount, scriptPubKey: outputScript }],
                  hexToU8(signingKeyHex)
                )
                txid = await broadcastTx(rawTx)
              }
            }
          } catch(e) {
            console.warn('On-chain anchor failed (trail still saved):', e)
          }
        }

        // 6. Save trail
        var trailJsonLd = {
          '@context': { 'schema': 'https://schema.org/', 'bt': 'https://blocktrails.org/ns/' },
          '@id': '#this',
          '@type': 'bt:Trail',
          'bt:privkey': privkeyHex,
          'bt:pubkeyBase': exp.pubkeyBase,
          'bt:state': exp.states.map(function(s, i) {
            var stateObj = {
              '@type': 'bt:State',
              'bt:value': s,
              'bt:witnessProgram': exp.witnessPrograms[i],
              'bt:address': wpToP2trAddress(exp.witnessPrograms[i], true),
              'bt:source': 'webledger.jsonld',
              'bt:contentHash': 'sha256:' + s,
              'bt:timestamp': i === currentIdx ? new Date().toISOString() : undefined
            }
            if (i === currentIdx && txid) {
              stateObj['bt:txid'] = txid
              stateObj['bt:confirmed'] = false
            }
            return stateObj
          })
        }
        await fetch(TRAIL_URL, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/ld+json' },
          body: JSON.stringify(trailJsonLd, null, 2)
        })

        snapshot['bt:txid'] = txid || null
        // Update history with txid
        await fetch(HISTORY_URL, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/ld+json' },
          body: JSON.stringify({
            '@context': { 'schema': 'https://schema.org/', 'bt': 'https://blocktrails.org/ns/' },
            '@id': '#this',
            '@type': 'bt:History',
            'bt:snapshots': history
          }, null, 2)
        })

        toast(txid ? 'Saved + anchored on Bitcoin! ' + truncate(txid) : 'Saved + trail advanced (off-chain)')
      } catch(e) {
        error = e.message
        toast('Save failed: ' + e.message)
        console.error(e)
      }
      saving = false
      renderApp()
    }

    // ── Render ───────────────────────────────────────────

    function renderApp() {
      if (!ledger) return

      var entries = ledger.entries || []
      var totalBalance = entries.reduce(function(s, e) {
        var amt = typeof e.amount === 'string' ? parseInt(e.amount) || 0 : 0
        return s + amt
      }, 0)
      var hasTrail = trail && trail.states.length > 0
      var stateCount = trail ? trail.states.length : 0

      render(container, html`
        <style>
          .wl-wrap { padding: 0 16px 40px; }
          .wl-hero { text-align: center; padding: 40px 0 32px; }
          .wl-hero-icon { font-size: 3rem; margin-bottom: 8px; }
          .wl-hero-title { font-size: 1.6rem; font-weight: 800; margin-bottom: 4px; }
          .wl-hero-sub { font-size: 0.9rem; color: rgba(255,255,255,0.35); }
          .wl-stats { display: flex; gap: 16px; justify-content: center; margin-bottom: 24px; flex-wrap: wrap; }
          .wl-stat { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 14px 24px; text-align: center; }
          .wl-stat-val { font-size: 1.5rem; font-weight: 700; color: #3b82f6; }
          .wl-stat-label { font-size: 0.7rem; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; }
          .wl-card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 24px; margin-bottom: 20px; backdrop-filter: blur(12px); }
          .wl-card h2 { font-size: 1rem; font-weight: 600; color: rgba(255,255,255,0.9); margin: 0 0 16px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
          .wl-input { padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.9); font: 0.88rem -apple-system, sans-serif; outline: none; }
          .wl-input::placeholder { color: rgba(255,255,255,0.25); }
          .wl-input:focus { border-color: rgba(59,130,246,0.5); }
          .wl-btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.8); font: 600 0.85rem -apple-system, sans-serif; cursor: pointer; transition: all 0.15s; }
          .wl-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
          .wl-btn-primary { background: linear-gradient(135deg, #3b82f6, #2563eb); border-color: rgba(59,130,246,0.4); color: #fff; box-shadow: 0 4px 16px rgba(59,130,246,0.2); }
          .wl-btn-primary:hover { box-shadow: 0 6px 24px rgba(59,130,246,0.3); }
          .wl-btn-anchor { background: linear-gradient(135deg, #f7931a, #e8850f); border-color: rgba(247,147,26,0.4); color: #000; box-shadow: 0 4px 16px rgba(247,147,26,0.2); }
          .wl-btn-anchor:hover { box-shadow: 0 6px 24px rgba(247,147,26,0.3); }
          .wl-btn-sm { padding: 5px 10px; font-size: 0.78rem; border-radius: 6px; }
          .wl-btn-danger { color: #ef4444; }
          .wl-btn-danger:hover { background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.3); }
          .wl-entry { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; margin-bottom: 8px; transition: background 0.15s; }
          .wl-entry:hover { background: rgba(255,255,255,0.06); }
          .wl-entry-url { flex: 1; font-size: 0.88rem; color: rgba(255,255,255,0.7); font-family: 'SF Mono', 'Fira Code', monospace; word-break: break-all; cursor: pointer; }
          .wl-entry-url:hover { color: rgba(255,255,255,0.9); }
          .wl-entry-amount { font-size: 1.1rem; font-weight: 700; color: #3b82f6; min-width: 80px; text-align: right; }
          .wl-entry-amount small { font-size: 0.65em; color: rgba(255,255,255,0.3); font-weight: 400; }
          .wl-entry-actions { display: flex; gap: 4px; }
          .wl-add-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
          .wl-empty { text-align: center; padding: 32px; color: rgba(255,255,255,0.25); font-style: italic; }
          .wl-error { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #ef4444; border-radius: 8px; padding: 10px 14px; font-size: 0.85rem; margin-bottom: 12px; }
          .wl-history-item { padding: 10px 14px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; margin-bottom: 6px; font-size: 0.82rem; }
          .wl-history-hash { color: rgba(59,130,246,0.6); font-family: 'SF Mono', monospace; font-size: 0.75rem; }
          .wl-history-time { color: rgba(255,255,255,0.25); font-size: 0.72rem; }
          .wl-history-entries { color: rgba(255,255,255,0.4); font-size: 0.75rem; margin-top: 4px; }
          .wl-spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.15); border-top-color: #3b82f6; border-radius: 50%; animation: v-spin 0.6s linear infinite; display: inline-block; }
          .wl-verify-card { margin-top: 16px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 20px; }
          @keyframes bt-slideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
          .wl-verify-header { display: flex; align-items: center; gap: 10px; font-size: 1.1rem; font-weight: 700; margin-bottom: 14px; }
          .wl-verify-icon { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1rem; }
          .wl-vi-pass { background: rgba(16,185,129,0.15); color: #10b981; border: 2px solid rgba(16,185,129,0.4); box-shadow: 0 0 16px rgba(16,185,129,0.2); }
          .wl-vi-fail { background: rgba(239,68,68,0.15); color: #ef4444; border: 2px solid rgba(239,68,68,0.4); }
          .wl-vi-warn { background: rgba(251,191,36,0.15); color: #fbbf24; border: 2px solid rgba(251,191,36,0.4); }
          .wl-vi-info { background: rgba(59,130,246,0.15); color: #3b82f6; border: 2px solid rgba(59,130,246,0.4); }
          .wl-verify-steps { display: flex; flex-direction: column; gap: 8px; }
          .wl-verify-step { display: flex; align-items: center; gap: 10px; font-size: 0.85rem; }
          .wl-vdot { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 700; flex-shrink: 0; }
          .wl-vdot-pass { background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); }
          .wl-vdot-fail { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }
          .wl-verify-label { color: rgba(255,255,255,0.4); font-weight: 600; min-width: 110px; }
          .wl-verify-val { color: rgba(255,255,255,0.6); font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.82rem; }
          .wl-save-bar { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; flex-wrap: wrap; }
          @media (max-width: 600px) { .wl-add-row { flex-direction: column; } .wl-entry { flex-wrap: wrap; } }
        </style>

        <div class="wl-wrap">
          <div class="wl-hero">
            <div class="wl-hero-icon">\uD83D\uDCCA</div>
            <div class="wl-hero-title">${ledger.name || 'Web Ledger'}</div>
            <div class="wl-hero-sub">${ledger.description || 'URI-to-balance mappings anchored to Bitcoin'}</div>
          </div>

          ${error ? html`<div class="wl-error">${error}</div>` : null}

          <div class="wl-stats">
            <div class="wl-stat">
              <div class="wl-stat-val">${String(entries.length)}</div>
              <div class="wl-stat-label">Entries</div>
            </div>
            <div class="wl-stat">
              <div class="wl-stat-val">${totalBalance.toLocaleString()}</div>
              <div class="wl-stat-label">${ledger.defaultCurrency || 'units'}</div>
            </div>
            <div class="wl-stat">
              <div class="wl-stat-val">${String(stateCount)}</div>
              <div class="wl-stat-label">Anchored</div>
            </div>
            <div class="wl-stat">
              <div class="wl-stat-val">${String(history.length)}</div>
              <div class="wl-stat-label">Snapshots</div>
            </div>
          </div>

          <div class="wl-card">
            <h2>
              Entries
              <button class="wl-btn wl-btn-sm" onclick="${function() { editingEntry = editingEntry === 'new' ? null : 'new'; renderApp() }}">
                ${editingEntry === 'new' ? '\u2716 Cancel' : '+ Add Entry'}
              </button>
            </h2>

            ${editingEntry === 'new' ? html`
              <div class="wl-add-row" style="margin-bottom:12px">
                <input class="wl-input wl-new-url" placeholder="URI (did:nostr:..., https://...)" style="flex:2"
                  onkeydown="${function(e) { if (e.key === 'Enter') addEntry() }}" />
                <input class="wl-input wl-new-amount" placeholder="Amount" style="flex:0.5;min-width:100px"
                  onkeydown="${function(e) { if (e.key === 'Enter') addEntry() }}" />
                <button class="wl-btn wl-btn-primary wl-btn-sm" onclick="${addEntry}">Add</button>
              </div>
            ` : null}

            ${entries.length === 0 ? html`
              <div class="wl-empty">No entries. Add a URI and balance to get started.</div>
            ` : null}

            ${entries.map(function(entry, i) {
              var amountStr = typeof entry.amount === 'string' ? entry.amount : JSON.stringify(entry.amount)
              if (editingEntry === i) {
                return html`
                  <div class="wl-add-row" style="margin-bottom:8px">
                    <input class="wl-input wl-edit-url" value="${entry.url}" style="flex:2" />
                    <input class="wl-input wl-edit-amount" value="${amountStr}" style="flex:0.5;min-width:100px" />
                    <button class="wl-btn wl-btn-primary wl-btn-sm" onclick="${function() { updateEntry(i) }}">\u2713</button>
                    <button class="wl-btn wl-btn-sm" onclick="${function() { editingEntry = null; renderApp() }}">\u2716</button>
                  </div>
                `
              }
              return html`
                <div class="wl-entry">
                  <div class="wl-entry-url" onclick="${function() { copyText(entry.url) }}" title="${entry.url}">
                    ${truncate(entry.url, 20, 12)}
                  </div>
                  <div class="wl-entry-amount">
                    ${parseInt(amountStr).toLocaleString()} ${html`<small>${ledger.defaultCurrency || ''}</small>`}
                  </div>
                  <div class="wl-entry-actions">
                    <button class="wl-btn wl-btn-sm" onclick="${function() { editingEntry = i; renderApp() }}">\u270E</button>
                    <button class="wl-btn wl-btn-sm wl-btn-danger" onclick="${function() { removeEntry(i); }}">\u2716</button>
                  </div>
                </div>
              `
            })}

            <div class="wl-save-bar">
              <button class="wl-btn" onclick="${verifyLedger}" disabled="${verifying}">
                ${verifying ? html`<span class="wl-spinner"></span>` : '\u2713'} Verify
              </button>
              <button class="wl-btn wl-btn-primary" onclick="${function() { saveLedger(false) }}" disabled="${saving}">
                ${saving ? html`<span class="wl-spinner"></span>` : '\uD83D\uDCBE'} Save
              </button>
              <button class="wl-btn wl-btn-anchor" onclick="${function() { saveLedger(true) }}" disabled="${saving || !privkeyHex}">
                ${saving ? html`<span class="wl-spinner"></span>` : '\u26D3'} Save + Anchor to Bitcoin
              </button>
            </div>

            ${verifyResult && !verifyResult.running ? html`
              <div class="wl-verify-card" style="animation: bt-slideIn 0.3s ease">
                <div class="wl-verify-header">
                  ${verifyResult.status === 'valid' ? html`
                    <span class="wl-verify-icon wl-vi-pass">\u2713</span>
                    <span>Ledger Verified</span>
                  ` : verifyResult.status === 'modified' ? html`
                    <span class="wl-verify-icon wl-vi-warn">\u26A0</span>
                    <span>Ledger Modified</span>
                  ` : verifyResult.status === 'no-trail' ? html`
                    <span class="wl-verify-icon wl-vi-info">\u2139</span>
                    <span>Not Anchored</span>
                  ` : html`
                    <span class="wl-verify-icon wl-vi-fail">\u2716</span>
                    <span>${verifyResult.message || 'Verification Failed'}</span>
                  `}
                </div>

                ${verifyResult.currentHash ? html`
                  <div class="wl-verify-steps">
                    <div class="wl-verify-step">
                      <span class="${'wl-vdot ' + (verifyResult.hashMatch ? 'wl-vdot-pass' : 'wl-vdot-fail')}">
                        ${verifyResult.hashMatch ? '\u2713' : '\u2716'}
                      </span>
                      <span class="wl-verify-label">Content hash</span>
                      <span class="wl-verify-val" onclick="${function() { copyText(verifyResult.currentHash) }}" style="cursor:pointer">
                        ${truncate('sha256:' + verifyResult.currentHash, 14, 8)}
                      </span>
                    </div>

                    ${verifyResult.hashMatch === false ? html`
                      <div class="wl-verify-step">
                        <span class="wl-vdot wl-vdot-fail">\u2716</span>
                        <span class="wl-verify-label">Anchored hash</span>
                        <span class="wl-verify-val" style="color:#ef4444">${truncate('sha256:' + verifyResult.anchoredHash, 14, 8)}</span>
                      </div>
                    ` : null}

                    ${verifyResult.chainValid !== undefined ? html`
                      <div class="wl-verify-step">
                        <span class="${'wl-vdot ' + (verifyResult.chainValid ? 'wl-vdot-pass' : 'wl-vdot-fail')}">
                          ${verifyResult.chainValid ? '\u2713' : '\u2716'}
                        </span>
                        <span class="wl-verify-label">Blocktrail chain</span>
                        <span class="wl-verify-val">${verifyResult.chainValid ? 'All witness programs match' : verifyResult.chainError || 'Invalid'}</span>
                      </div>
                    ` : null}

                    ${verifyResult.onChain !== undefined && verifyResult.onChain !== null ? html`
                      <div class="wl-verify-step">
                        <span class="${'wl-vdot ' + (verifyResult.onChain ? 'wl-vdot-pass' : 'wl-vdot-fail')}">
                          ${verifyResult.onChain ? '\u2713' : '\u2716'}
                        </span>
                        <span class="wl-verify-label">Bitcoin</span>
                        <span class="wl-verify-val">
                          ${verifyResult.confirmed ? 'Confirmed' : verifyResult.onChain ? 'Pending' : 'Not found'}
                          ${verifyResult.txid ? html` \u00B7 <a href="${'https://mempool.space/testnet4/tx/' + verifyResult.txid}" target="_blank" rel="noopener" style="color:rgba(247,147,26,0.6);text-decoration:none">${truncate(verifyResult.txid, 6, 4)}</a>` : null}
                        </span>
                      </div>
                    ` : null}
                  </div>
                ` : null}

                ${verifyResult.status === 'modified' ? html`
                  <div style="margin-top:12px;font-size:0.78rem;color:rgba(255,255,255,0.3)">
                    The ledger has been modified since last anchor. Click "Save + Anchor to Bitcoin" to record the new state.
                  </div>
                ` : null}
              </div>
            ` : verifyResult && verifyResult.running ? html`
              <div class="wl-verify-card" style="animation: bt-slideIn 0.3s ease">
                <div class="wl-verify-header">
                  <span class="wl-spinner"></span>
                  <span>Verifying\u2026</span>
                </div>
              </div>
            ` : null}
          </div>

          ${history.length > 0 ? html`
            <div class="wl-card">
              <h2>
                History
                <span style="font-size:0.75rem;color:rgba(255,255,255,0.25);font-weight:400">${String(history.length)} snapshot${history.length > 1 ? 's' : ''}</span>
              </h2>
              ${history.slice().reverse().map(function(snap) {
                var hash = snap['bt:contentHash'] || ''
                var time = snap['bt:timestamp'] || ''
                var txid = snap['bt:txid'] || ''
                var content = snap['bt:content']
                var entryCount = content && content.entries ? content.entries.length : '?'
                var totalAmt = 0
                if (content && content.entries) {
                  content.entries.forEach(function(e) { totalAmt += parseInt(e.amount) || 0 })
                }
                return html`
                  <div class="wl-history-item">
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px">
                      <span class="wl-history-hash" onclick="${function() { copyText(hash) }}" style="cursor:pointer" title="Click to copy hash">
                        ${truncate(hash, 12, 8)}
                      </span>
                      <span class="wl-history-time">${time ? new Date(time).toLocaleString() : ''}</span>
                    </div>
                    <div class="wl-history-entries">
                      ${String(entryCount)} entries \u00B7 ${totalAmt.toLocaleString()} total
                      ${txid ? html` \u00B7 <a href="${'https://mempool.space/testnet4/tx/' + txid}" target="_blank" rel="noopener" style="color:rgba(247,147,26,0.6);text-decoration:none">${truncate(txid, 6, 4)}</a>` : null}
                    </div>
                  </div>
                `
              })}
            </div>
          ` : null}
        </div>
      `)
    }

    renderApp()
    onUnmount(container, function() {})
  }
}
