/**
 * TXO URI Parser - Tests
 */

import { parseTxoUri, isValidTxoUri, formatTxoUri } from './index.js'

const TXID = '4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb'
let pass = 0
let fail = 0

function assert (condition, msg) {
  if (condition) {
    pass++
    console.log(`  \x1b[32m✓\x1b[0m ${msg}`)
  } else {
    fail++
    console.log(`  \x1b[31m✗\x1b[0m ${msg}`)
  }
}

function eq (a, b, msg) {
  assert(a === b, msg + (a !== b ? ` (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})` : ''))
}

function section (name) {
  console.log(`\n${name}`)
}

// ── Parse ────────────────────────────────────────────

section('parseTxoUri')

const p1 = parseTxoUri(`txo:btc:${TXID}:0`)
eq(p1.network, 'btc', 'minimal: network')
eq(p1.txid, TXID, 'minimal: txid')
eq(p1.output, 0, 'minimal: output')

const p2 = parseTxoUri(`txo:btc:${TXID}:0?amount=0.75`)
eq(p2.amount, 0.75, 'amount parsed as number')

const p3 = parseTxoUri(`txo:btc:${TXID}:0?amount=1000&privkey=Kx9abc`)
eq(p3.amount, 1000, 'amount with privkey')
eq(p3.privkey, 'Kx9abc', 'privkey from ?privkey=')

const p4 = parseTxoUri(`txo:btc:${TXID}:0?amount=500&key=deadbeef`)
eq(p4.privkey, 'deadbeef', '?key= normalized to privkey')
assert(p4.key === undefined, '?key= does not also appear as .key')

const p5 = parseTxoUri(`txo:btc:${TXID}:0?amount=100&script_type=p2tr`)
eq(p5.script_type, 'p2tr', 'script_type preserved')

const p6 = parseTxoUri(`txo:tbtc4:${TXID}:1?amount=1.5&privkey=Kx9&script_type=p2tr`)
eq(p6.network, 'tbtc4', 'testnet4 network')
eq(p6.output, 1, 'output index 1')
eq(p6.privkey, 'Kx9', 'privkey with other params')

const p7 = parseTxoUri(`txo:btc:${TXID}:4294967295`)
eq(p7.output, 4294967295, 'max output index')

// ── Legacy format ────────────────────────────────────

section('parseTxoUri (legacy)')

const l1 = parseTxoUri(`txo:btc:${TXID}:0 0.75`)
eq(l1.amount, 0.75, 'legacy: amount')
assert(l1.privkey === undefined, 'legacy: no privkey when only amount')

const l2 = parseTxoUri(`txo:btc:${TXID}:0 0.75 Kx9abc`)
eq(l2.amount, 0.75, 'legacy: amount with key')
eq(l2.privkey, 'Kx9abc', 'legacy: privkey')

// ── Validate ─────────────────────────────────────────

section('isValidTxoUri')

assert(isValidTxoUri(`txo:btc:${TXID}:0`), 'valid minimal')
assert(isValidTxoUri(`txo:btc:${TXID}:0?amount=1&key=abc`), 'valid with key alias')
assert(!isValidTxoUri(''), 'rejects empty')
assert(!isValidTxoUri('txo:BITCOIN:abc:0'), 'rejects uppercase network')
assert(!isValidTxoUri('txo:btc:shortid:0'), 'rejects short txid')
assert(!isValidTxoUri('http:btc:' + TXID + ':0'), 'rejects wrong scheme')
assert(!isValidTxoUri('txo:btc:' + TXID + ':-1'), 'rejects negative output')

// ── Format ───────────────────────────────────────────

section('formatTxoUri')

eq(
  formatTxoUri({ network: 'btc', txid: TXID, output: 0 }),
  `txo:btc:${TXID}:0`,
  'minimal format'
)

eq(
  formatTxoUri({ network: 'btc', txid: TXID, output: 0, amount: 0.75 }),
  `txo:btc:${TXID}:0?amount=0.75`,
  'format with amount'
)

const formatted = formatTxoUri({ network: 'btc', txid: TXID, output: 0, key: 'abc123' })
assert(formatted.includes('privkey=abc123'), 'format normalizes key→privkey')
assert(!formatted.includes('&key=') && !formatted.includes('?key='), 'format does not output key=')

const formatted2 = formatTxoUri({ network: 'btc', txid: TXID, output: 0, amount: 100, privkey: 'Kx9', script_type: 'p2tr' })
assert(formatted2.indexOf('amount=') < formatted2.indexOf('privkey='), 'amount before privkey in output')
assert(formatted2.indexOf('privkey=') < formatted2.indexOf('script_type='), 'privkey before script_type in output')

// ── Round-trip ───────────────────────────────────────

section('Round-trip')

function roundTrip (uri, label) {
  const parsed = parseTxoUri(uri)
  const reformatted = formatTxoUri(parsed)
  const reparsed = parseTxoUri(reformatted)
  eq(JSON.stringify(reparsed), JSON.stringify(parsed), label)
}

roundTrip(`txo:btc:${TXID}:0`, 'minimal round-trip')
roundTrip(`txo:btc:${TXID}:0?amount=0.75`, 'amount round-trip')
roundTrip(`txo:btc:${TXID}:0?amount=1000&privkey=Kx9abc`, 'amount+privkey round-trip')
roundTrip(`txo:btc:${TXID}:0?amount=500&key=deadbeef`, 'key alias round-trip')

// ── Summary ──────────────────────────────────────────

console.log(`\n${'─'.repeat(40)}`)
console.log(`${pass + fail} tests, \x1b[32m${pass} passed\x1b[0m${fail > 0 ? `, \x1b[31m${fail} failed\x1b[0m` : ''}`)
process.exit(fail > 0 ? 1 : 0)
