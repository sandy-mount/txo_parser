import { html, render, keyed, onUnmount } from 'https://losos.org/losos/html.js'
import {
  decodeKey, privkeyToAddress, isHexKey,
  buildTransaction, estimateVsize,
  fetchUtxos, checkOutspend, fetchTxDetails, broadcastTx, getFeeRate,
  bytesToHex, hexToU8,
  parseTxoUri, isValidTxoUri,
  toSats, buildTxoUri, parseVoucherFromItem
} from '../lib/bitcoin.js'

export default {
  label: 'Vouchers',
  icon: '\uD83C\uDFAB',

  canHandle(subject, store) {
    var node = store.get(subject.value)
    if (!node) return false
    var type = store.type(node)
    return type && type.includes('VoucherPool')
  },

  render(subject, lionStore, container, rawData) {

    // ── Load state ──────────────────────────────────────
    var DATA_URL = new URL('voucher-data.jsonld', location.href).href
    var data = rawData || {}
    var items = data['schema:itemListElement'] || []
    var vouchers = items.map(parseVoucherFromItem)

    var importing = false
    var refreshing = false
    var mergeMode = false
    var mergeSelected = new Set()
    var splitTarget = null
    var addKeyTarget = null
    var revealedKeys = new Set()

    // ── Persistence ─────────────────────────────────────

    function saveToStorage() {
      var jsonLd = {
        '@context': { 'schema': 'https://schema.org/', 'bt': 'https://blocktrails.org/ns/' },
        '@id': '#this',
        '@type': 'VoucherPool',
        'schema:name': 'Voucher Pool',
        'schema:description': 'Testnet4 voucher management and faucet',
        'schema:hasPart': [
          { '@id': 'blocktrail.jsonld#this' },
          { '@id': 'webledger.jsonld#this' },
          { '@id': 'ledger-history.jsonld#this' }
        ],
        'schema:itemListElement': vouchers.map(function(v) {
          return {
            '@type': 'schema:ListItem',
            '@id': v.id,
            'schema:identifier': buildTxoUri(v),
            'schema:address': v.address,
            'schema:status': v.status,
            'schema:dateCreated': v.dateAdded
          }
        })
      }
      // PUT to Solid server
      fetch(DATA_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/ld+json' },
        body: JSON.stringify(jsonLd, null, 2)
      }).catch(function(e) { console.warn('PUT failed:', e) })
    }

    // ── Helpers ─────────────────────────────────────────

    function truncate(s, start, end) {
      start = start || 8; end = end || 6
      if (!s || s.length <= start + end + 3) return s
      return s.slice(0, start) + '\u2026' + s.slice(-end)
    }

    function maskKey(wif) {
      if (!wif || wif.length < 6) return '***'
      return wif.slice(0, 3) + '\u2026' + wif.slice(-3)
    }

    function satsBtc(sats) { return (sats / 1e8).toFixed(8) }

    function toast(msg) {
      var t = document.createElement('div')
      t.className = 'v-toast'
      t.textContent = msg
      document.body.appendChild(t)
      setTimeout(function() { t.remove() }, 2000)
    }

    function copyText(text) {
      navigator.clipboard.writeText(text).then(function() { toast('Copied') })
    }

    // ── Import ──────────────────────────────────────────

    async function importKey(input) {
      input = input.trim()
      if (!input) return

      if (input.startsWith('txo:') || isValidTxoUri(input)) {
        try {
          var parsed = parseTxoUri(input)
          var exists = vouchers.some(function(v) { return v.txid === parsed.txid && v.vout === parsed.output })
          if (exists) { toast('Already in pool'); return }
          var v = {
            id: Date.now().toString(36),
            txid: parsed.txid, vout: parsed.output,
            amount: toSats(parsed.amount),
            privkey: parsed.privkey || parsed.key || '',
            address: '', network: 'btc',
            status: 'unknown',
            dateAdded: new Date().toISOString()
          }
          if (v.privkey) {
            try {
              var decoded = await decodeKey(v.privkey)
              v.address = privkeyToAddress(decoded.privkey, decoded.testnet)
            } catch {}
          }
          vouchers.unshift(v)
          saveToStorage()
          toast('Voucher imported')
          renderApp()
          refreshStatus(vouchers.indexOf(v))
          return
        } catch (e) {
          console.warn('TXO parse failed, trying as WIF:', e)
        }
      }

      try {
        var decoded = await decodeKey(input)
        var address = privkeyToAddress(decoded.privkey, decoded.testnet)
        var keyless = vouchers.filter(function(v) { return !v.privkey })
        var matched = false

        if (keyless.length > 0) {
          var utxos = await fetchUtxos(address)
          for (var kv of keyless) {
            var matchesUtxo = utxos.some(function(u) { return u.txid === kv.txid && u.vout === kv.vout })
            if (matchesUtxo) {
              kv.privkey = input
              kv.address = address
              kv.status = 'unspent'
              var u = utxos.find(function(u) { return u.txid === kv.txid && u.vout === kv.vout })
              if (u && u.value) kv.amount = u.value
              matched = true
            }
          }
          if (matched) {
            saveToStorage()
            toast('Key matched to voucher')
            renderApp()
            return
          }
        }

        toast('Looking up UTXOs\u2026')
        var utxos = await fetchUtxos(address)
        if (utxos.length === 0) { toast('No UTXOs found'); return }

        var added = 0
        for (var ux of utxos) {
          var exists = vouchers.some(function(v) { return v.txid === ux.txid && v.vout === ux.vout })
          if (exists) continue
          vouchers.unshift({
            id: Date.now().toString(36) + added,
            txid: ux.txid, vout: ux.vout,
            amount: ux.value,
            privkey: input, address: address,
            network: 'btc',
            status: ux.status && ux.status.confirmed ? 'unspent' : 'unconfirmed',
            dateAdded: new Date().toISOString()
          })
          added++
        }

        if (added === 0) toast('All UTXOs already in pool')
        else { saveToStorage(); toast('Imported ' + added + ' voucher' + (added > 1 ? 's' : '')) }
        renderApp()
      } catch (e) {
        toast('Import failed: ' + e.message)
        console.error(e)
      }
    }

    // ── Refresh status ──────────────────────────────────

    async function refreshStatus(index) {
      if (index !== undefined) {
        var v = vouchers[index]
        if (!v) return
        var result = await checkOutspend(v.txid, v.vout)
        if (result) {
          var newStatus = result.spent ? 'spent' : 'unspent'
          if (v.status !== newStatus) {
            v.status = newStatus
            saveToStorage()
          }
          renderApp()
        }
        return
      }

      refreshing = true
      renderApp()
      var changed = false
      for (var i = 0; i < vouchers.length; i++) {
        try {
          var result = await checkOutspend(vouchers[i].txid, vouchers[i].vout)
          if (result) {
            var newStatus = result.spent ? 'spent' : 'unspent'
            if (vouchers[i].status !== newStatus) {
              vouchers[i].status = newStatus
              changed = true
            }
          }
        } catch {}
      }
      if (changed) saveToStorage()
      refreshing = false
      renderApp()
    }

    // ── Split ───────────────────────────────────────────

    async function confirmSplit(voucherId) {
      var v = vouchers.find(function(x) { return x.id === voucherId })
      if (!v || !v.privkey || v.status !== 'unspent') {
        toast('Voucher must be unspent with a key'); return
      }
      var countEl = container.querySelector('.v-split-input')
      var numSplits = parseInt(countEl && countEl.value) || 2
      if (numSplits < 2 || numSplits > 100) { toast('Split into 2\u2013100 outputs'); return }

      var decoded = await decodeKey(v.privkey)
      var txDetails = await fetchTxDetails(v.txid)
      var prevOut = txDetails.vout[v.vout]
      if (!prevOut) { toast('Could not find output'); return }
      var scriptPubKey = hexToU8(prevOut.scriptpubkey)

      var feeRate = await getFeeRate()
      var vsize = estimateVsize(1, numSplits)
      var fee = Math.ceil(vsize * feeRate)
      var available = v.amount - fee
      if (available <= 0) { toast('Not enough for fee'); return }

      var perOutput = Math.floor(available / numSplits)
      if (perOutput <= 546) { toast('Split amounts too small (dust)'); return }

      if (!confirm('Split ' + v.amount.toLocaleString() + ' sats into ' + numSplits + ' outputs of ~' + perOutput.toLocaleString() + ' sats?\nFee: ' + fee + ' sats (' + feeRate + ' sat/vB)')) return

      toast('Building transaction\u2026')
      var outputs = []
      var remaining = available
      for (var i = 0; i < numSplits; i++) {
        var amt = i === numSplits - 1 ? remaining : perOutput
        outputs.push({ amount: amt, scriptPubKey: scriptPubKey })
        remaining -= amt
      }

      var rawTx = await buildTransaction(
        [{ txid: v.txid, vout: v.vout, amount: v.amount, scriptPubKey: scriptPubKey }],
        outputs, decoded.privkey
      )
      var newTxid = await broadcastTx(rawTx)
      toast('Split broadcast! ' + truncate(newTxid))

      v.status = 'spent'
      for (var i = 0; i < outputs.length; i++) {
        vouchers.unshift({
          id: Date.now().toString(36) + i,
          txid: newTxid, vout: i,
          amount: outputs[i].amount,
          privkey: v.privkey, address: v.address,
          network: 'btc', status: 'unspent',
          dateAdded: new Date().toISOString()
        })
      }
      splitTarget = null
      saveToStorage()
      renderApp()
    }

    // ── Merge ───────────────────────────────────────────

    async function mergeVouchers() {
      var selected = []
      mergeSelected.forEach(function(id) {
        var v = vouchers.find(function(x) { return x.id === id })
        if (v) selected.push(v)
      })
      if (selected.length < 2) { toast('Select at least 2'); return }
      if (selected.some(function(v) { return !v.privkey || v.status !== 'unspent' })) {
        toast('All must be unspent with keys'); return
      }
      var key = selected[0].privkey
      if (!selected.every(function(v) { return v.privkey === key })) {
        toast('All must use the same key'); return
      }

      var decoded = await decodeKey(key)
      var inputs = []
      for (var sv of selected) {
        var details = await fetchTxDetails(sv.txid)
        var out = details.vout[sv.vout]
        if (!out) { toast('Could not find output for ' + truncate(sv.txid)); return }
        inputs.push({ txid: sv.txid, vout: sv.vout, amount: sv.amount, scriptPubKey: hexToU8(out.scriptpubkey) })
      }

      var feeRate = await getFeeRate()
      var vsize = estimateVsize(selected.length, 1)
      var fee = Math.ceil(vsize * feeRate)
      var totalInput = selected.reduce(function(s, v) { return s + v.amount }, 0)
      var outputAmount = totalInput - fee
      if (outputAmount <= 546) { toast('Not enough for fee'); return }

      if (!confirm('Merge ' + selected.length + ' vouchers (' + totalInput.toLocaleString() + ' sats) into one?\nOutput: ' + outputAmount.toLocaleString() + ' sats\nFee: ' + fee + ' sats (' + feeRate + ' sat/vB)')) return

      toast('Building transaction\u2026')
      var rawTx = await buildTransaction(inputs, [{ amount: outputAmount, scriptPubKey: inputs[0].scriptPubKey }], decoded.privkey)
      var newTxid = await broadcastTx(rawTx)
      toast('Merge broadcast! ' + truncate(newTxid))

      for (var sv of selected) sv.status = 'spent'
      vouchers.unshift({
        id: Date.now().toString(36),
        txid: newTxid, vout: 0,
        amount: outputAmount,
        privkey: key, address: selected[0].address,
        network: 'btc', status: 'unspent',
        dateAdded: new Date().toISOString()
      })
      mergeSelected.clear()
      mergeMode = false
      saveToStorage()
      renderApp()
    }

    // ── Add key to voucher ──────────────────────────────

    async function submitKey(voucherId) {
      var input = container.querySelector('.v-key-input')
      var wif = input && input.value.trim()
      if (!wif) { toast('Paste a key'); return }
      var v = vouchers.find(function(x) { return x.id === voucherId })
      if (!v) return
      try {
        var decoded = await decodeKey(wif)
        var address = privkeyToAddress(decoded.privkey, decoded.testnet)
        var utxos = await fetchUtxos(address)
        var match = utxos.find(function(u) { return u.txid === v.txid && u.vout === v.vout })
        if (!match) { toast('Key does not match this UTXO'); return }
        v.privkey = wif
        v.address = address
        v.status = 'unspent'
        if (match.value) v.amount = match.value
        addKeyTarget = null
        saveToStorage()
        toast('Key added!')
        renderApp()
      } catch (e) {
        toast('Invalid key: ' + e.message)
      }
    }

    // ── Render ───────────────────────────────────────────

    function renderApp() {
      var unspent = vouchers.filter(function(v) { return v.status === 'unspent' })
      var totalSats = unspent.reduce(function(s, v) { return s + (v.amount || 0) }, 0)
      var spentCount = vouchers.filter(function(v) { return v.status === 'spent' }).length
      var canMerge = vouchers.filter(function(v) { return v.privkey && v.status === 'unspent' }).length >= 2

      var mergeSats = 0
      mergeSelected.forEach(function(id) {
        var v = vouchers.find(function(x) { return x.id === id })
        if (v) mergeSats += v.amount || 0
      })

      render(container, html`
        <style>
          .v-wrap { padding: 0 16px 40px; }
          .v-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
          .v-title { font-size: 1.5em; font-weight: 800; display: flex; align-items: center; gap: 10px; }
          .v-net { font-size: 0.6em; padding: 4px 10px; border-radius: 6px; background: rgba(251,191,36,0.12); border: 1px solid rgba(251,191,36,0.3); color: #fbbf24; font-weight: 600; letter-spacing: 0.04em; }
          .v-hero { text-align: center; padding: 32px 0 28px; }
          .v-hero-label { font-size: 0.78rem; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
          .v-hero-sats { font-size: 2.8rem; font-weight: 800; letter-spacing: -0.02em; }
          .v-hero-btc { font-size: 0.95rem; color: rgba(255,255,255,0.35); margin-top: 2px; }
          .v-card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 24px; margin-bottom: 20px; backdrop-filter: blur(12px); }
          .v-card h2 { font-size: 1rem; font-weight: 600; color: rgba(255,255,255,0.9); margin: 0 0 16px; display: flex; align-items: center; justify-content: space-between; }
          .v-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
          .v-stat { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 14px; text-align: center; }
          .v-stat-val { font-size: 1.5rem; font-weight: 700; }
          .v-stat-label { font-size: 0.7rem; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; }
          .v-import-row { display: flex; gap: 8px; }
          .v-input { flex: 1; padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.9); font: 0.88rem -apple-system, sans-serif; outline: none; transition: border-color 0.15s; }
          .v-input::placeholder { color: rgba(255,255,255,0.25); }
          .v-input:focus { border-color: rgba(124,58,237,0.5); }
          .v-btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.8); font: 600 0.85rem -apple-system, sans-serif; cursor: pointer; transition: all 0.15s; }
          .v-btn:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.15); color: #fff; }
          .v-btn-primary { background: linear-gradient(135deg, #7c3aed, #6d28d9); border-color: rgba(124,58,237,0.4); color: #fff; box-shadow: 0 4px 16px rgba(124,58,237,0.2); }
          .v-btn-primary:hover { box-shadow: 0 6px 24px rgba(124,58,237,0.3); }
          .v-btn-sm { padding: 5px 10px; font-size: 0.78rem; border-radius: 6px; }
          .v-btn-icon { padding: 5px 8px; font-size: 0.82rem; border-radius: 6px; min-width: 30px; justify-content: center; }
          .v-btn-danger { color: #ef4444; }
          .v-btn-danger:hover { background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.3); }
          .v-item { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 14px 16px; margin-bottom: 10px; transition: background 0.15s; }
          .v-item:hover { background: rgba(255,255,255,0.06); }
          .v-item-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
          .v-item-amount { font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; gap: 8px; }
          .v-item-amount small { font-size: 0.7em; font-weight: 400; color: rgba(255,255,255,0.35); }
          .v-item-actions { display: flex; gap: 4px; flex-wrap: wrap; }
          .v-item-details { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 0.82rem; }
          .v-item-label { color: rgba(255,255,255,0.3); }
          .v-item-val { color: rgba(255,255,255,0.6); font-family: 'SF Mono', 'Fira Code', monospace; word-break: break-all; cursor: pointer; }
          .v-item-val:hover { color: rgba(255,255,255,0.9); }
          .v-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 6px; font-size: 0.72rem; font-weight: 600; }
          .v-badge-unspent { background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.3); color: #10b981; }
          .v-badge-spent { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #ef4444; }
          .v-badge-unknown { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.35); }
          .v-badge-locked { background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.3); color: #fbbf24; }
          .v-badge-dot { width: 6px; height: 6px; border-radius: 50%; }
          .v-empty { text-align: center; padding: 32px; color: rgba(255,255,255,0.25); font-style: italic; }
          .v-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: rgba(16,185,129,0.9); color: #fff; padding: 8px 20px; border-radius: 8px; font-size: 0.85rem; font-weight: 600; z-index: 999; animation: v-fade 0.3s; }
          @keyframes v-fade { from { opacity: 0; transform: translateX(-50%) translateY(8px); } }
          .v-spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.15); border-top-color: #a78bfa; border-radius: 50%; animation: v-spin 0.6s linear infinite; display: inline-block; }
          @keyframes v-spin { to { transform: rotate(360deg); } }
          .v-help { font-size: 0.78rem; color: rgba(255,255,255,0.25); margin-top: 10px; line-height: 1.5; }
          .v-help code { background: rgba(255,255,255,0.06); padding: 1px 5px; border-radius: 4px; font-size: 0.92em; }
          .v-merge-bar { margin-top: 12px; padding: 14px; background: rgba(124,58,237,0.1); border: 1px solid rgba(124,58,237,0.3); border-radius: 10px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
          .v-expand { margin-top: 10px; }
          @media (max-width: 600px) {
            .v-stats { grid-template-columns: 1fr; }
            .v-hero-sats { font-size: 2rem; }
            .v-import-row { flex-direction: column; }
          }
        </style>

        <div class="v-wrap">
          <div class="v-header">
            <div class="v-title">\uD83C\uDFAB Voucher Pool <span class="v-net">TESTNET4</span></div>
          </div>

          <div class="v-hero">
            <div class="v-hero-label">Available Balance</div>
            <div class="v-hero-sats">${totalSats.toLocaleString()} <span style="font-size:0.4em;color:rgba(255,255,255,0.35)">sats</span></div>
            <div class="v-hero-btc">${satsBtc(totalSats)} tBTC</div>
          </div>

          <div class="v-stats">
            <div class="v-stat">
              <div class="v-stat-val">${String(vouchers.length)}</div>
              <div class="v-stat-label">Total Vouchers</div>
            </div>
            <div class="v-stat">
              <div class="v-stat-val" style="color:#10b981">${String(unspent.length)}</div>
              <div class="v-stat-label">Unspent</div>
            </div>
            <div class="v-stat">
              <div class="v-stat-val" style="color:#ef4444">${String(spentCount)}</div>
              <div class="v-stat-label">Spent</div>
            </div>
          </div>

          <div class="v-card">
            <h2>Import Voucher</h2>
            <div class="v-import-row">
              <input class="v-input v-import-input" placeholder="Paste hex key, WIF, or TXO URI\u2026"
                onkeydown="${function(e) { if (e.key === 'Enter') doImport() }}"
                oninput="${function(e) { if (isHexKey(e.target.value.trim())) doImport() }}" />
              <button class="v-btn v-btn-primary" onclick="${doImport}">
                ${importing ? html`<span class="v-spinner"></span>` : 'Import'}
              </button>
            </div>
            <div class="v-help">
              Accepts 64-char hex keys, WIF private keys (testnet4), or TXO URIs.
            </div>
          </div>

          <div class="v-card">
            <h2>
              Vouchers
              <div style="display:flex;gap:6px">
                ${canMerge ? html`
                  <button class="${'v-btn v-btn-sm' + (mergeMode ? ' v-btn-merge-active' : '')}"
                    style="${mergeMode ? 'color:#a78bfa;border-color:rgba(167,139,250,0.4)' : ''}"
                    onclick="${function() { mergeMode = !mergeMode; mergeSelected.clear(); renderApp() }}">
                    ${mergeMode ? '\u2716 Cancel' : '\uD83D\uDD00 Merge'}
                  </button>
                ` : null}
                <button class="v-btn v-btn-sm" onclick="${function() { refreshStatus() }}"
                  disabled="${refreshing}">
                  ${refreshing ? html`<span class="v-spinner"></span> Checking\u2026` : '\u21BB Refresh'}
                </button>
                ${vouchers.length > 0 ? html`
                  <button class="v-btn v-btn-sm v-btn-danger" onclick="${clearAll}">\u2716 Clear All</button>
                ` : null}
              </div>
            </h2>

            ${vouchers.length === 0 ? html`
              <div class="v-empty">No vouchers yet. Import a key or TXO URI to get started.</div>
            ` : null}

            ${keyed(vouchers, function(v) { return v.id }, function(v) {
              return renderVoucherItem(v)
            })}

            ${mergeMode && mergeSelected.size >= 2 ? html`
              <div class="v-merge-bar">
                <span style="font-size:0.88rem">
                  Merge <strong>${String(mergeSelected.size)}</strong> vouchers (${mergeSats.toLocaleString()} sats)
                </span>
                <button class="v-btn v-btn-primary" onclick="${function() { mergeVouchers().catch(function(e) { toast('Merge failed: ' + e.message) }) }}">
                  \uD83D\uDD00 Merge Now
                </button>
              </div>
            ` : null}
          </div>
        </div>
      `)
    }

    // ── Voucher item template ───────────────────────────

    function renderVoucherItem(v) {
      var hasKey = !!v.privkey
      var badgeClass = v.status === 'unspent' ? 'v-badge v-badge-unspent'
        : v.status === 'spent' ? 'v-badge v-badge-spent'
        : 'v-badge v-badge-unknown'
      var badgeLabel = v.status === 'unspent' ? 'Unspent' : v.status === 'spent' ? 'Spent' : 'Unknown'
      var badgeDotStyle = v.status === 'unspent' ? 'background:#10b981'
        : v.status === 'spent' ? 'background:#ef4444'
        : 'background:rgba(255,255,255,0.3)'

      var itemStyle = !hasKey ? 'border-color:rgba(251,191,36,0.2)'
        : mergeSelected.has(v.id) ? 'border-color:rgba(167,139,250,0.4)'
        : ''

      var isRevealed = revealedKeys.has(v.id)

      return html`
        <div class="v-item" style="${itemStyle}">
          <div class="v-item-top">
            <div class="v-item-amount">
              ${mergeMode && hasKey && v.status === 'unspent' ? html`
                <input type="checkbox" checked="${mergeSelected.has(v.id) ? true : false}"
                  style="width:16px;height:16px;accent-color:#7c3aed;cursor:pointer"
                  onchange="${function(e) {
                    if (e.target.checked) mergeSelected.add(v.id)
                    else mergeSelected.delete(v.id)
                    renderApp()
                  }}" />
              ` : null}
              ${(v.amount || 0).toLocaleString()} ${html`<small>sats</small>`}
              <span class="${badgeClass}"><span class="v-badge-dot" style="${badgeDotStyle}"></span>${badgeLabel}</span>
              ${!hasKey ? html`<span class="v-badge v-badge-locked"><span class="v-badge-dot" style="background:#fbbf24"></span>No Key</span>` : null}
            </div>
            <div class="v-item-actions">
              ${!hasKey ? html`
                <button class="v-btn v-btn-sm" style="color:#fbbf24;border-color:rgba(251,191,36,0.3)"
                  onclick="${function() { addKeyTarget = addKeyTarget === v.id ? null : v.id; renderApp() }}">
                  \uD83D\uDD11 Add Key
                </button>
              ` : null}
              ${hasKey && v.status === 'unspent' && !mergeMode ? html`
                <button class="v-btn v-btn-sm"
                  onclick="${function() { splitTarget = splitTarget === v.id ? null : v.id; renderApp() }}">
                  \u2702 Split
                </button>
              ` : null}
              ${hasKey ? html`
                <button class="v-btn v-btn-icon" title="Copy TXO URI"
                  onclick="${function() { copyText(buildTxoUri(v)) }}">\u2398</button>
              ` : null}
              ${hasKey ? html`
                <button class="v-btn v-btn-icon" title="Copy share link"
                  onclick="${function() { copyText(location.origin + location.pathname + '?key=' + v.privkey) }}">\uD83D\uDD17</button>
              ` : null}
              ${hasKey ? html`
                <button class="v-btn v-btn-icon" title="Copy private key"
                  onclick="${function() { copyText(v.privkey) }}">\uD83D\uDD11</button>
              ` : null}
              <button class="v-btn v-btn-icon v-btn-danger" title="Delete"
                onclick="${function() { vouchers = vouchers.filter(function(x) { return x.id !== v.id }); saveToStorage(); renderApp() }}">\u2716</button>
            </div>
          </div>

          <div class="v-item-details">
            <span class="v-item-label">TXID</span>
            <a class="v-item-val" href="${'https://mempool.space/testnet4/tx/' + v.txid}" target="_blank" rel="noopener"
              style="color:rgba(167,139,250,0.8);text-decoration:none">
              ${truncate(v.txid) + ':' + v.vout}
            </a>
            ${v.address ? html`
              <span class="v-item-label">Address</span>
              <span class="v-item-val" onclick="${function() { copyText(v.address) }}">${truncate(v.address, 10, 6)}</span>
            ` : null}
            ${hasKey ? html`
              <span class="v-item-label">Key</span>
              <span class="v-item-val" style="cursor:pointer;user-select:none"
                onclick="${function() {
                  if (isRevealed) revealedKeys.delete(v.id)
                  else revealedKeys.add(v.id)
                  renderApp()
                }}">
                ${isRevealed ? v.privkey : maskKey(v.privkey)}
                ${!isRevealed ? html`<span style="font-size:0.8em;color:rgba(255,255,255,0.2)"> (click)</span>` : null}
              </span>
            ` : null}
          </div>

          ${v.id === addKeyTarget ? html`
            <div class="v-expand">
              <div class="v-import-row">
                <input class="v-input v-key-input" placeholder="Paste hex or WIF private key\u2026"
                  onkeydown="${function(e) { if (e.key === 'Enter') submitKey(v.id) }}"
                  oninput="${function(e) { if (isHexKey(e.target.value.trim())) submitKey(v.id) }}" />
                <button class="v-btn v-btn-primary v-btn-sm" onclick="${function() { submitKey(v.id) }}">\uD83D\uDD11 Unlock</button>
              </div>
            </div>
          ` : null}

          ${v.id === splitTarget ? html`
            <div class="v-expand">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <span style="color:rgba(255,255,255,0.5);font-size:0.82rem">Split into</span>
                <input type="number" class="v-input v-split-input" value="2" min="2" max="100"
                  style="width:70px;text-align:center" />
                <span style="color:rgba(255,255,255,0.5);font-size:0.82rem">outputs</span>
                <button class="v-btn v-btn-primary v-btn-sm"
                  onclick="${function() { confirmSplit(v.id).catch(function(e) { toast('Split failed: ' + e.message) }) }}">
                  \u2702 Confirm
                </button>
                <button class="v-btn v-btn-sm"
                  onclick="${function() { splitTarget = null; renderApp() }}">\u2716</button>
              </div>
            </div>
          ` : null}
        </div>
      `
    }

    // ── Actions ─────────────────────────────────────────

    async function doImport() {
      if (importing) return
      var input = container.querySelector('.v-import-input')
      if (!input || !input.value.trim()) return
      importing = true
      renderApp()
      await importKey(input.value)
      importing = false
      renderApp()
    }

    function clearAll() {
      if (!confirm('Delete all vouchers?')) return
      vouchers = []
      saveToStorage()
      renderApp()
    }

    // ── Init ────────────────────────────────────────────

    renderApp()

    // Auto-import from ?key= parameter
    if (window.__pendingImport) {
      var keyToImport = window.__pendingImport
      delete window.__pendingImport
      importing = true
      renderApp()
      importKey(keyToImport).then(function() {
        importing = false
        renderApp()
      })
    }

    // No auto-refresh on load — it triggers PUT which causes live-reload loop.
    // User clicks "Refresh" manually.

    onUnmount(container, function() {
      // Cleanup if needed
    })
  }
}
