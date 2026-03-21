import { html, render, keyed, onUnmount } from 'https://losos.org/losos/html.js'
import { Blocktrail, verify, genesis as btGenesis, transition as btTransition, hexToBytes } from 'https://esm.sh/blocktrails@0.0.11'
import {
  parseVoucherFromItem, decodeKey, bytesToHex,
  buildTransaction, estimateVsize, fetchUtxos, fetchTxDetails, broadcastTx, getFeeRate, hexToU8,
  wpToP2trAddress
} from '../lib/bitcoin.js'

export default {
  label: 'Blocktrails',
  icon: '\u26D3',

  canHandle(subject, store) {
    var node = store.get(subject.value)
    if (!node) return false
    var type = store.type(node)
    return type && type.includes('VoucherPool')
  },

  render(subject, lionStore, container, rawData) {

    // ── State ───────────────────────────────────────────

    var TRAIL_URL = new URL('blocktrail.jsonld', location.href).href
    var MEMPOOL_BASE = 'https://mempool.space/testnet4'
    var trail = null
    var privkeyHex = ''
    var error = null
    var verifyResult = null
    var onchainStatus = {} // index → { funded, txid, confirmed }
    var funding = false
    var advancing = false

    // Load persisted trail from blocktrail.jsonld
    function loadTrailFromData(data) {
      try {
        var storedPrivkey = data['bt:privkey'] || ''
        var stateNodes = data['bt:state'] || []
        if (!Array.isArray(stateNodes)) stateNodes = [stateNodes]
        var storedStates = stateNodes.map(function(n) {
          return typeof n === 'string' ? n : (n['bt:value'] || '')
        }).filter(Boolean)

        if (storedPrivkey && storedStates.length > 0) {
          privkeyHex = storedPrivkey
          trail = new Blocktrail(storedPrivkey)
          for (var i = 0; i < storedStates.length; i++) {
            if (i === 0) trail.genesis(storedStates[i])
            else trail.advance(storedStates[i])
          }
          // Restore on-chain status
          for (var j = 0; j < stateNodes.length; j++) {
            var n = stateNodes[j]
            if (typeof n === 'object' && n['bt:txid']) {
              onchainStatus[j] = { funded: true, txid: n['bt:txid'], confirmed: n['bt:confirmed'] || false }
            }
          }
        }
      } catch(e) {
        console.warn('Failed to load trail:', e)
      }
    }

    // Fetch trail data from server
    fetch(TRAIL_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function(res) { return res.ok ? res.json() : null })
      .then(function(data) {
        if (data && data['bt:privkey']) {
          loadTrailFromData(data)
          renderApp()
        }
      })
      .catch(function(e) { console.warn('Failed to fetch trail:', e) })

    // ── Helpers ─────────────────────────────────────────

    function toast(msg) {
      var t = document.createElement('div')
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(247,147,26,0.9);color:#000;padding:8px 20px;border-radius:8px;font-size:0.85rem;font-weight:600;z-index:999;animation:v-fade 0.3s'
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

    // Get P2TR address for state at index (testnet4) from witness program
    function getAddress(stateIndex) {
      try {
        var exp = trail.export()
        var wp = exp.witnessPrograms[stateIndex]
        if (!wp) return ''
        return wpToP2trAddress(wp, true) // true = testnet
      } catch(e) { return '' }
    }

    // Get signing key for state at index
    function getSigningKey(stateIndex) {
      try {
        if (stateIndex === 0) {
          var g = btGenesis(hexToBytes(privkeyHex), trail.states[0])
          return g ? g.derivedPrivkey : ''
        } else {
          var prevStates = trail.states.slice(0, stateIndex)
          var t = btTransition(hexToBytes(privkeyHex), prevStates, trail.states[stateIndex])
          return t ? t.signingPrivkey : ''
        }
      } catch(e) { return '' }
    }

    function saveTrail() {
      if (!trail || !privkeyHex) return
      var exp = trail.export()
      var jsonLd = {
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
            'bt:address': getAddress(i)
          }
          if (onchainStatus[i]) {
            stateObj['bt:txid'] = onchainStatus[i].txid
            stateObj['bt:confirmed'] = onchainStatus[i].confirmed
          }
          return stateObj
        })
      }
      fetch(TRAIL_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/ld+json' },
        body: JSON.stringify(jsonLd, null, 2)
      }).catch(function(e) { console.warn('PUT blocktrail failed:', e) })
    }

    // ── Actions ─────────────────────────────────────────

    function initTrail() {
      var keyInput = container.querySelector('.bt-key-input')
      var stateInput = container.querySelector('.bt-state-input')
      var key = keyInput && keyInput.value.trim()
      var state = stateInput && stateInput.value.trim()
      if (!key || key.length !== 64) { toast('Enter a 64-char hex private key'); return }
      if (!state) { toast('Enter genesis state'); return }

      try {
        privkeyHex = key
        trail = new Blocktrail(key)
        trail.genesis(state)
        error = null
        saveTrail()
        toast('Trail initialized')
        renderApp()
      } catch(e) {
        error = e.message
        renderApp()
      }
    }

    function advanceTrail() {
      var input = container.querySelector('.bt-advance-input')
      var state = input && input.value.trim()
      if (!state) { toast('Enter new state'); return }
      if (!trail) { toast('No active trail'); return }

      try {
        trail.advance(state)
        error = null
        saveTrail()
        toast('State advanced')
        renderApp()
      } catch(e) {
        error = e.message
        renderApp()
      }
    }

    // Fund genesis address from a voucher
    async function fundGenesis() {
      if (!trail || funding) return
      funding = true
      renderApp()

      try {
        var genesisAddr = getAddress(0)
        if (!genesisAddr) throw new Error('Could not derive genesis address')

        // Find a funded voucher from the pool
        var poolRes = await fetch(new URL('voucher-data.jsonld', location.href).href + '?t=' + Date.now(), { cache: 'no-store' })
        var poolData = poolRes.ok ? await poolRes.json() : rawData
        var items = (poolData && poolData['schema:itemListElement']) || []
        var voucher = null
        for (var item of items) {
          var v = parseVoucherFromItem(item)
          if (v.privkey && v.status === 'unspent' && v.amount > 1000) { voucher = v; break }
        }
        if (!voucher) throw new Error('No funded voucher available')

        var decoded = await decodeKey(voucher.privkey)
        var txDetails = await fetchTxDetails(voucher.txid)
        var prevOut = txDetails.vout[voucher.vout]
        if (!prevOut) throw new Error('Could not find UTXO')
        var scriptPubKey = hexToU8(prevOut.scriptpubkey)

        // Build tx: voucher → genesis address
        var feeRate = await getFeeRate()
        var vsize = estimateVsize(1, 1)
        var fee = Math.ceil(vsize * feeRate)
        var outputAmount = voucher.amount - fee
        if (outputAmount <= 546) throw new Error('Voucher too small for fee')

        // Genesis output script (P2TR)
        var genesisWp = trail.export().witnessPrograms[0]
        var outputScript = new Uint8Array(34)
        outputScript[0] = 0x51 // OP_1
        outputScript[1] = 0x20 // push 32 bytes
        var wpBytes = hexToU8(genesisWp)
        outputScript.set(wpBytes, 2)

        if (!confirm('Fund genesis with ' + outputAmount.toLocaleString() + ' sats from voucher?\nFee: ' + fee + ' sats (' + feeRate + ' sat/vB)\nTo: ' + genesisAddr)) {
          funding = false; renderApp(); return
        }

        var rawTx = await buildTransaction(
          [{ txid: voucher.txid, vout: voucher.vout, amount: voucher.amount, scriptPubKey: scriptPubKey }],
          [{ amount: outputAmount, scriptPubKey: outputScript }],
          decoded.privkey
        )
        var newTxid = await broadcastTx(rawTx)
        onchainStatus[0] = { funded: true, txid: newTxid, confirmed: false }
        saveTrail()
        toast('Genesis funded! ' + truncate(newTxid))
      } catch(e) {
        toast('Fund failed: ' + e.message)
        console.error(e)
      }
      funding = false
      renderApp()
    }

    // Advance on-chain: spend from current state to next
    async function advanceOnChain() {
      if (!trail || advancing) return
      var input = container.querySelector('.bt-advance-input')
      var newState = input && input.value.trim()
      if (!newState) { toast('Enter new state'); return }

      var currentIdx = trail.states.length - 1
      if (!onchainStatus[currentIdx] || !onchainStatus[currentIdx].funded) {
        toast('Current state not funded on-chain'); return
      }

      advancing = true
      renderApp()

      try {
        // Get current state's UTXO
        var currentAddr = getAddress(currentIdx)
        var currentSigningKey = getSigningKey(currentIdx)
        if (!currentSigningKey) throw new Error('Could not derive signing key')

        var utxos = await fetchUtxos(currentAddr)
        if (utxos.length === 0) throw new Error('No UTXO at current address')
        var utxo = utxos[0]

        // Advance the trail locally first to get new address
        trail.advance(newState)
        var newIdx = trail.states.length - 1
        var newAddr = getAddress(newIdx)
        var newWp = trail.export().witnessPrograms[newIdx]

        // Build output script
        var outputScript = new Uint8Array(34)
        outputScript[0] = 0x51
        outputScript[1] = 0x20
        outputScript.set(hexToU8(newWp), 2)

        // Get scriptPubKey for the input
        var txDetails = await fetchTxDetails(utxo.txid)
        var prevOut = txDetails.vout[utxo.vout]
        var inputScript = hexToU8(prevOut.scriptpubkey)

        var feeRate = await getFeeRate()
        var vsize = estimateVsize(1, 1)
        var fee = Math.ceil(vsize * feeRate)
        var outputAmount = utxo.value - fee
        if (outputAmount <= 546) throw new Error('UTXO too small for fee')

        if (!confirm('Advance on-chain: ' + outputAmount.toLocaleString() + ' sats\nFee: ' + fee + ' sats (' + feeRate + ' sat/vB)\nTo: ' + newAddr)) {
          // Undo the advance
          trail = new Blocktrail(privkeyHex)
          for (var i = 0; i < trail.states.length; i++) {
            // Replay is not possible this way, need to reconstruct
          }
          // Simpler: reload
          advancing = false; location.reload(); return
        }

        var rawTx = await buildTransaction(
          [{ txid: utxo.txid, vout: utxo.vout, amount: utxo.value, scriptPubKey: inputScript }],
          [{ amount: outputAmount, scriptPubKey: outputScript }],
          hexToU8(currentSigningKey)
        )
        var newTxid = await broadcastTx(rawTx)
        onchainStatus[newIdx] = { funded: true, txid: newTxid, confirmed: false }
        saveTrail()
        toast('State advanced on-chain! ' + truncate(newTxid))
      } catch(e) {
        toast('Advance failed: ' + e.message)
        console.error(e)
      }
      advancing = false
      renderApp()
    }

    // Check on-chain status for all states
    async function checkOnChain() {
      if (!trail) return
      for (var i = 0; i < trail.states.length; i++) {
        try {
          var addr = getAddress(i)
          if (!addr) continue
          var utxos = await fetchUtxos(addr)
          if (utxos.length > 0) {
            onchainStatus[i] = {
              funded: true,
              txid: utxos[0].txid,
              confirmed: utxos[0].status && utxos[0].status.confirmed
            }
          }
        } catch(e) {}
      }
      saveTrail()
      renderApp()
    }

    var verifying = false

    async function verifyChain() {
      if (!trail || verifying) return
      verifying = true
      verifyResult = { running: true, steps: [] }
      renderApp()

      var exp = trail.export()

      // Step through each state with a delay for visual effect
      // verify() expects witnessPrograms as Uint8Array[], but export() returns hex strings
      var wpBytes = exp.witnessPrograms.map(function(wp) { return hexToU8(wp) })

      for (var i = 0; i < exp.states.length; i++) {
        await new Promise(function(r) { setTimeout(r, 300) })
        try {
          var partial = verify(exp.pubkeyBase, exp.states.slice(0, i + 1), wpBytes.slice(0, i + 1))
          verifyResult.steps.push({ index: i, valid: partial.valid, state: exp.states[i] })
        } catch(e) {
          verifyResult.steps.push({ index: i, valid: false, state: exp.states[i], error: e.message })
        }
        renderApp()
      }

      await new Promise(function(r) { setTimeout(r, 200) })
      var allValid = verifyResult.steps.every(function(s) { return s.valid })
      verifyResult.running = false
      verifyResult.valid = allValid
      verifying = false
      renderApp()
    }

    function resetTrail() {
      if (!confirm('Reset blocktrail? This clears all state history.')) return
      trail = null
      privkeyHex = ''
      error = null
      verifyResult = null
      onchainStatus = {}
      var emptyTrail = {
        '@context': { 'schema': 'https://schema.org/', 'bt': 'https://blocktrails.org/ns/' },
        '@id': '#this', '@type': 'bt:Trail', 'bt:pubkeyBase': '', 'bt:state': []
      }
      fetch(TRAIL_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/ld+json' },
        body: JSON.stringify(emptyTrail, null, 2)
      }).catch(function(e) { console.warn('PUT reset failed:', e) })
      renderApp()
    }

    async function useVoucherKey() {
      try {
        var poolRes = await fetch(new URL('voucher-data.jsonld', location.href).href + '?t=' + Date.now(), { cache: 'no-store' })
        var poolData = poolRes.ok ? await poolRes.json() : rawData
        var items = (poolData && poolData['schema:itemListElement']) || []
        for (var item of items) {
          var v = parseVoucherFromItem(item)
          if (v.privkey) {
            var keyInput = container.querySelector('.bt-key-input')
            if (!keyInput) return
            if (v.privkey.length === 64 && /^[0-9a-fA-F]{64}$/.test(v.privkey)) {
              keyInput.value = v.privkey
            } else {
              try {
                var decoded = await decodeKey(v.privkey)
                keyInput.value = bytesToHex(decoded.privkey)
              } catch(e) { keyInput.value = v.privkey }
            }
            toast('Key loaded from voucher pool')
            return
          }
        }
        toast('No keyed vouchers found')
      } catch(e) { toast('Could not read voucher pool: ' + e.message) }
    }

    // ── Render ───────────────────────────────────────────

    function renderApp() {
      var exp = trail ? trail.export() : null
      var states = exp ? exp.states : []
      var programs = exp ? exp.witnessPrograms : []
      var currentIdx = states.length - 1
      var currentFunded = onchainStatus[currentIdx] && onchainStatus[currentIdx].funded

      render(container, html`
        <style>
          .bt-wrap { padding: 0 16px 40px; }
          .bt-hero { text-align: center; padding: 40px 0 32px; }
          .bt-hero-icon { font-size: 3rem; margin-bottom: 8px; }
          .bt-hero-title { font-size: 1.6rem; font-weight: 800; margin-bottom: 4px; }
          .bt-hero-sub { font-size: 0.9rem; color: rgba(255,255,255,0.35); }
          .bt-card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 24px; margin-bottom: 20px; backdrop-filter: blur(12px); }
          .bt-card h2 { font-size: 1rem; font-weight: 600; color: rgba(255,255,255,0.9); margin: 0 0 16px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
          .bt-input { width: 100%; padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.9); font: 0.88rem -apple-system, sans-serif; outline: none; margin-bottom: 10px; }
          .bt-input::placeholder { color: rgba(255,255,255,0.25); }
          .bt-input:focus { border-color: rgba(247,147,26,0.5); }
          .bt-row { display: flex; gap: 8px; }
          .bt-btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.8); font: 600 0.85rem -apple-system, sans-serif; cursor: pointer; transition: all 0.15s; }
          .bt-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
          .bt-btn-primary { background: linear-gradient(135deg, #f7931a, #e8850f); border-color: rgba(247,147,26,0.4); color: #000; box-shadow: 0 4px 16px rgba(247,147,26,0.2); }
          .bt-btn-primary:hover { box-shadow: 0 6px 24px rgba(247,147,26,0.3); }
          .bt-btn-green { background: linear-gradient(135deg, #10b981, #059669); border-color: rgba(16,185,129,0.4); color: #fff; box-shadow: 0 4px 16px rgba(16,185,129,0.2); }
          .bt-btn-sm { padding: 5px 10px; font-size: 0.78rem; border-radius: 6px; }
          .bt-btn-danger { color: #ef4444; }
          .bt-btn-danger:hover { background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.3); }
          .bt-error { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #ef4444; border-radius: 8px; padding: 10px 14px; font-size: 0.85rem; margin-bottom: 12px; }
          .bt-chain { position: relative; padding-left: 24px; }
          .bt-chain::before { content: ''; position: absolute; left: 9px; top: 0; bottom: 0; width: 2px; background: rgba(247,147,26,0.2); }
          .bt-state { position: relative; margin-bottom: 16px; padding: 14px 16px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; }
          .bt-state::before { content: ''; position: absolute; left: -19px; top: 18px; width: 10px; height: 10px; border-radius: 50%; background: #f7931a; border: 2px solid rgba(247,147,26,0.4); }
          .bt-state:last-child::before { box-shadow: 0 0 8px rgba(247,147,26,0.4); }
          .bt-state-funded::before { background: #10b981; border-color: rgba(16,185,129,0.4); }
          .bt-state-funded:last-child::before { box-shadow: 0 0 8px rgba(16,185,129,0.4); }
          .bt-state-idx { font-size: 0.7rem; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
          .bt-state-val { font-size: 0.88rem; color: rgba(255,255,255,0.8); word-break: break-all; margin-bottom: 6px; font-family: 'SF Mono', 'Fira Code', monospace; }
          .bt-state-detail { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; font-size: 0.78rem; margin-top: 8px; }
          .bt-state-label { color: rgba(255,255,255,0.25); }
          .bt-state-val2 { color: rgba(255,255,255,0.5); font-family: 'SF Mono', 'Fira Code', monospace; cursor: pointer; word-break: break-all; }
          .bt-state-val2:hover { color: rgba(255,255,255,0.8); }
          .bt-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 5px; font-size: 0.68rem; font-weight: 600; margin-left: 8px; }
          .bt-badge-onchain { background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.3); color: #10b981; }
          .bt-badge-pending { background: rgba(251,191,36,0.12); border: 1px solid rgba(251,191,36,0.3); color: #fbbf24; }
          .bt-badge-offchain { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.3); }
          .bt-verify-card { margin-top: 16px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 20px; animation: bt-slideIn 0.3s ease; }
          @keyframes bt-slideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
          .bt-verify-header { display: flex; align-items: center; gap: 10px; font-size: 1.1rem; font-weight: 700; margin-bottom: 16px; }
          .bt-verify-icon { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1rem; }
          .bt-verify-pass { background: rgba(16,185,129,0.15); color: #10b981; border: 2px solid rgba(16,185,129,0.4); box-shadow: 0 0 16px rgba(16,185,129,0.2); }
          .bt-verify-failed { background: rgba(239,68,68,0.15); color: #ef4444; border: 2px solid rgba(239,68,68,0.4); }
          .bt-verify-steps { display: flex; flex-direction: column; gap: 8px; }
          .bt-verify-step { display: flex; align-items: center; gap: 10px; font-size: 0.85rem; padding: 6px 0; animation: bt-fadeStep 0.3s ease; }
          @keyframes bt-fadeStep { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }
          .bt-verify-dot { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 700; flex-shrink: 0; }
          .bt-vdot-pass { background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); }
          .bt-vdot-fail { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }
          .bt-verify-step-label { color: rgba(255,255,255,0.5); font-weight: 600; min-width: 70px; }
          .bt-verify-step-val { color: rgba(255,255,255,0.7); font-family: 'SF Mono', 'Fira Code', monospace; }
          .bt-verify-step-err { color: #ef4444; font-size: 0.78rem; }
          .bt-verify-summary { margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 0.78rem; color: rgba(16,185,129,0.6); letter-spacing: 0.02em; }
          .bt-stats { display: flex; gap: 16px; justify-content: center; margin-bottom: 24px; flex-wrap: wrap; }
          .bt-stat { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 14px 24px; text-align: center; }
          .bt-stat-val { font-size: 1.5rem; font-weight: 700; color: #f7931a; }
          .bt-stat-label { font-size: 0.7rem; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; }
          .bt-help { font-size: 0.78rem; color: rgba(255,255,255,0.25); margin-top: 10px; line-height: 1.5; }
          .bt-spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.15); border-top-color: #f7931a; border-radius: 50%; animation: v-spin 0.6s linear infinite; display: inline-block; }
          @media (max-width: 600px) { .bt-row { flex-direction: column; } }
        </style>

        <div class="bt-wrap">
          <div class="bt-hero">
            <div class="bt-hero-icon">\u26D3</div>
            <div class="bt-hero-title">Blocktrails</div>
            <div class="bt-hero-sub">Anchor state to Bitcoin with Nostr-native key chaining</div>
          </div>

          ${error ? html`<div class="bt-error">${error}</div>` : null}

          ${!trail ? html`
            <div class="bt-card">
              <h2>Initialize Trail</h2>
              <div class="bt-row" style="margin-bottom:10px">
                <input class="bt-input bt-key-input" placeholder="Private key (64-char hex)\u2026" style="flex:1;margin-bottom:0" />
                <button class="bt-btn bt-btn-sm" onclick="${useVoucherKey}" title="Load key from voucher pool">\uD83D\uDD11 From Pool</button>
              </div>
              <input class="bt-input bt-state-input" placeholder="Genesis state (e.g. JSON)\u2026"
                onkeydown="${function(e) { if (e.key === 'Enter') initTrail() }}" />
              <button class="bt-btn bt-btn-primary" onclick="${initTrail}">\u26D3 Create Trail</button>
              <div class="bt-help">
                Each state produces a unique P2TR address via chained key tweaking.<br/>
                The chain of spends is the state history \u2014 immutably ordered by Bitcoin.
              </div>
            </div>
          ` : html`
            <div class="bt-stats">
              <div class="bt-stat">
                <div class="bt-stat-val">${String(states.length)}</div>
                <div class="bt-stat-label">States</div>
              </div>
              <div class="bt-stat">
                <div class="bt-stat-val">${truncate(exp.pubkeyBase, 6, 4)}</div>
                <div class="bt-stat-label">Base Pubkey</div>
              </div>
              <div class="bt-stat">
                <div class="bt-stat-val">${String(Object.keys(onchainStatus).filter(function(k) { return onchainStatus[k].funded }).length)}</div>
                <div class="bt-stat-label">On-Chain</div>
              </div>
            </div>

            <div class="bt-card">
              <h2>
                ${currentFunded ? 'Advance On-Chain' : 'Advance State'}
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                  ${states.length > 0 && !onchainStatus[0] ? html`
                    <button class="bt-btn bt-btn-sm bt-btn-green" onclick="${fundGenesis}"
                      disabled="${funding}">
                      ${funding ? html`<span class="bt-spinner"></span>` : '\u26A1'} Fund Genesis
                    </button>
                  ` : null}
                  <button class="bt-btn bt-btn-sm" onclick="${checkOnChain}">\u21BB Check Chain</button>
                  <button class="bt-btn bt-btn-sm" onclick="${verifyChain}">\u2713 Verify</button>
                  <button class="bt-btn bt-btn-sm" onclick="${function() {
                    var exp = trail.export()
                    copyText(JSON.stringify({ pubkeyBase: exp.pubkeyBase, states: exp.states, witnessPrograms: exp.witnessPrograms }, null, 2))
                  }}">\u2398 Export</button>
                  <button class="bt-btn bt-btn-sm bt-btn-danger" onclick="${resetTrail}">\u2716 Reset</button>
                </div>
              </h2>
              <div class="bt-row">
                <input class="bt-input bt-advance-input" placeholder="New state\u2026" style="flex:1;margin-bottom:0"
                  onkeydown="${function(e) { if (e.key === 'Enter') { if (currentFunded) advanceOnChain(); else advanceTrail() } }}" />
                ${currentFunded ? html`
                  <button class="bt-btn bt-btn-green" onclick="${advanceOnChain}" disabled="${advancing}">
                    ${advancing ? html`<span class="bt-spinner"></span>` : '\u26A1'} Advance + Broadcast
                  </button>
                ` : html`
                  <button class="bt-btn bt-btn-primary" onclick="${advanceTrail}">\u2192 Advance</button>
                `}
              </div>

              ${verifyResult ? html`
                <div class="bt-verify-card">
                  <div class="bt-verify-header">
                    ${verifyResult.running ? html`
                      <span class="bt-spinner"></span> Verifying chain\u2026
                    ` : verifyResult.valid ? html`
                      <span class="bt-verify-icon bt-verify-pass">\u2713</span>
                      <span>Chain Verified</span>
                    ` : html`
                      <span class="bt-verify-icon bt-verify-failed">\u2716</span>
                      <span>Verification Failed</span>
                    `}
                  </div>
                  ${verifyResult.steps && verifyResult.steps.length > 0 ? html`
                    <div class="bt-verify-steps">
                      ${verifyResult.steps.map(function(step) {
                        return html`
                          <div class="bt-verify-step">
                            <span class="${'bt-verify-dot ' + (step.valid ? 'bt-vdot-pass' : 'bt-vdot-fail')}">
                              ${step.valid ? '\u2713' : '\u2716'}
                            </span>
                            <span class="bt-verify-step-label">
                              ${step.index === 0 ? 'Genesis' : 'State ' + step.index}
                            </span>
                            <span class="bt-verify-step-val">${step.state}</span>
                            ${step.error ? html`<span class="bt-verify-step-err">${step.error}</span>` : null}
                          </div>
                        `
                      })}
                      ${verifyResult.running && verifyResult.steps.length < states.length ? html`
                        <div class="bt-verify-step">
                          <span class="bt-spinner" style="width:12px;height:12px"></span>
                          <span class="bt-verify-step-label" style="color:rgba(255,255,255,0.3)">
                            ${verifyResult.steps.length === 0 ? 'Genesis' : 'State ' + verifyResult.steps.length}
                          </span>
                        </div>
                      ` : null}
                    </div>
                  ` : null}
                  ${!verifyResult.running && verifyResult.valid ? html`
                    <div class="bt-verify-summary">
                      ${String(states.length)} state${states.length > 1 ? 's' : ''} \u00B7 all witness programs match \u00B7 pubkey ${truncate(exp.pubkeyBase, 6, 4)}
                    </div>
                  ` : null}
                </div>
              ` : null}
            </div>

            <div class="bt-card">
              <h2>State Chain</h2>
              <div class="bt-chain">
                ${keyed(states.map(function(s, i) { return { s: s, i: i } }), function(item) { return 'state-' + item.i }, function(item) {
                  var s = item.s, i = item.i
                  var wp = programs[i] || ''
                  var addr = getAddress(i)
                  var isGenesis = i === 0
                  var isCurrent = i === states.length - 1
                  var status = onchainStatus[i]
                  var isFunded = status && status.funded
                  var isConfirmed = status && status.confirmed

                  return html`
                    <div class="${'bt-state' + (isFunded ? ' bt-state-funded' : '')}" style="${isCurrent ? 'border-color:rgba(247,147,26,0.3)' : ''}">
                      <div class="bt-state-idx">
                        ${isGenesis ? 'Genesis' : 'State ' + i}${isCurrent ? ' (current)' : ''}
                        ${isFunded ? html`
                          <span class="${'bt-badge ' + (isConfirmed ? 'bt-badge-onchain' : 'bt-badge-pending')}">
                            ${isConfirmed ? '\u2713 Confirmed' : '\u23F3 Pending'}
                          </span>
                        ` : html`<span class="bt-badge bt-badge-offchain">Off-chain</span>`}
                      </div>
                      <div class="bt-state-val">${s}</div>

                      <div class="bt-state-detail">
                        ${addr ? html`
                          <span class="bt-state-label">Address</span>
                          <span class="bt-state-val2" onclick="${function() { copyText(addr) }}">${truncate(addr, 12, 8)}</span>
                        ` : null}
                        ${wp ? html`
                          <span class="bt-state-label">Witness</span>
                          <span class="bt-state-val2" onclick="${function() { copyText(wp) }}">${truncate(wp, 10, 8)}</span>
                        ` : null}
                        ${status && status.txid ? html`
                          <span class="bt-state-label">TXID</span>
                          <a class="bt-state-val2" href="${MEMPOOL_BASE + '/tx/' + status.txid}" target="_blank" rel="noopener"
                            style="color:rgba(167,139,250,0.8);text-decoration:none">${truncate(status.txid)}</a>
                        ` : null}
                      </div>
                    </div>
                  `
                })}
              </div>
            </div>
          `}
        </div>
      `)
    }

    renderApp()
    onUnmount(container, function() {})
  }
}
