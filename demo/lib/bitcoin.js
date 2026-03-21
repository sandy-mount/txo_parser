import { parseTxoUri, isValidTxoUri, formatTxoUri } from 'https://esm.sh/txo_parser'
import { secp256k1, schnorr } from 'https://esm.sh/@noble/curves@1.8.1/secp256k1'

// ── Base58 ──────────────────────────────────────────────

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function b58decode(str) {
  const bytes = []
  for (const c of str) {
    let carry = B58.indexOf(c)
    if (carry < 0) throw new Error('Invalid base58 character: ' + c)
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58
      bytes[j] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8 }
  }
  for (const c of str) { if (c === '1') bytes.push(0); else break }
  return new Uint8Array(bytes.reverse())
}

// ── Hash helpers ────────────────────────────────────────

export async function sha256(data) {
  const buf = data instanceof Uint8Array ? data : new TextEncoder().encode(data)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf))
}

async function doubleSha256(data) {
  return sha256(await sha256(data))
}

// ── WIF / Key decode ────────────────────────────────────

async function wifDecode(wif) {
  const raw = b58decode(wif)
  if (raw.length < 5) throw new Error('WIF too short')
  const payload = raw.slice(0, -4)
  const checksum = raw.slice(-4)
  const hash = await doubleSha256(payload)
  for (let i = 0; i < 4; i++) {
    if (hash[i] !== checksum[i]) throw new Error('Invalid WIF checksum')
  }
  const version = payload[0]
  const isTestnet = version === 0xef
  const isMainnet = version === 0x80
  if (!isTestnet && !isMainnet) throw new Error('Unknown WIF version: 0x' + version.toString(16))
  const compressed = payload.length === 34 && payload[33] === 0x01
  return { privkey: payload.slice(1, 33), compressed, testnet: isTestnet }
}

export function hexToBytes(hex) {
  if (hex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('Invalid 64-char hex key')
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

export function isHexKey(s) {
  return s.length === 64 && /^[0-9a-fA-F]{64}$/.test(s)
}

export async function decodeKey(input) {
  if (isHexKey(input)) {
    return { privkey: hexToBytes(input), compressed: true, testnet: true }
  }
  return wifDecode(input)
}

function privkeyToXOnly(privkeyBytes) {
  const pub = secp256k1.getPublicKey(privkeyBytes, true)
  return pub.slice(1)
}

// ── Bech32m (P2TR addresses) ────────────────────────────

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const BECH32M = 0x2bc830a3

function polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let chk = 1
  for (const v of values) {
    const b = chk >> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i]
  }
  return chk
}

function hrpExpand(hrp) {
  const r = []
  for (const c of hrp) r.push(c.charCodeAt(0) >> 5)
  r.push(0)
  for (const c of hrp) r.push(c.charCodeAt(0) & 31)
  return r
}

function convertBits(data, from, to, pad) {
  let acc = 0, bits = 0
  const ret = [], maxv = (1 << to) - 1
  for (const v of data) {
    acc = (acc << from) | v
    bits += from
    while (bits >= to) { bits -= to; ret.push((acc >> bits) & maxv) }
  }
  if (pad && bits > 0) ret.push((acc << (to - bits)) & maxv)
  return ret
}

function bech32mEncode(hrp, version, program) {
  const conv = convertBits(program, 8, 5, true)
  const values = [version, ...conv]
  const enc = [...hrpExpand(hrp), ...values, 0, 0, 0, 0, 0, 0]
  const mod = polymod(enc) ^ BECH32M
  const checksum = [0,1,2,3,4,5].map(i => (mod >> (5 * (5 - i))) & 31)
  let result = hrp + '1'
  for (const v of [...values, ...checksum]) result += BECH32_CHARSET[v]
  return result
}

export function wpToP2trAddress(wpHex, testnet) {
  if (testnet === undefined) testnet = true
  const program = hexToU8(wpHex)
  return bech32mEncode(testnet ? 'tb' : 'bc', 1, program)
}

export function privkeyToAddress(privkeyBytes, testnet) {
  if (testnet === undefined) testnet = true
  const xonly = privkeyToXOnly(privkeyBytes)
  return bech32mEncode(testnet ? 'tb' : 'bc', 1, xonly)
}

// ── Byte helpers ────────────────────────────────────────

export function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function hexToU8(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function concatBytes(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const result = new Uint8Array(total)
  let off = 0
  for (const a of arrays) { result.set(a, off); off += a.length }
  return result
}

// ── Tagged hash (BIP340/341) ────────────────────────────

async function taggedHash(tag, ...msgs) {
  const tagHash = await sha256(new TextEncoder().encode(tag))
  return sha256(concatBytes(tagHash, tagHash, ...msgs))
}

// ── Taproot key tweaking (BIP86) ────────────────────────

const SECP_N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141')

function bytesToBigInt(bytes) {
  let r = 0n
  for (const b of bytes) r = (r << 8n) | BigInt(b)
  return r
}

function bigIntToBytes(n) {
  const hex = n.toString(16).padStart(64, '0')
  return hexToU8(hex)
}

async function getTweakedKeys(privkeyBytes) {
  const xonly = privkeyToXOnly(privkeyBytes)
  const tweak = await taggedHash('TapTweak', xonly)
  const t = bytesToBigInt(tweak)
  let d = bytesToBigInt(privkeyBytes)
  const fullPub = secp256k1.getPublicKey(privkeyBytes, false)
  if (fullPub[64] & 1) d = SECP_N - d
  const tweakedD = (d + t) % SECP_N
  const tweakedPriv = bigIntToBytes(tweakedD)
  const tweakedXOnly = schnorr.getPublicKey(tweakedPriv)
  return { tweakedPriv, tweakedXOnly, internalXOnly: xonly }
}

export function p2trScript(xonlyPubkey) {
  return concatBytes(new Uint8Array([0x51, 0x20]), xonlyPubkey)
}

// ── Transaction serialization ───────────────────────────

function writeU32LE(val) {
  const b = new Uint8Array(4)
  b[0] = val & 0xff; b[1] = (val >> 8) & 0xff; b[2] = (val >> 16) & 0xff; b[3] = (val >> 24) & 0xff
  return b
}

function writeU64LE(val) {
  const b = new Uint8Array(8)
  const n = BigInt(val)
  for (let i = 0; i < 8; i++) b[i] = Number((n >> BigInt(i * 8)) & 0xffn)
  return b
}

function writeVarInt(val) {
  if (val < 0xfd) return new Uint8Array([val])
  if (val <= 0xffff) return new Uint8Array([0xfd, val & 0xff, (val >> 8) & 0xff])
  throw new Error('VarInt too large')
}

function reverseTxid(txidHex) {
  const bytes = hexToU8(txidHex)
  bytes.reverse()
  return bytes
}

export function estimateVsize(numInputs, numOutputs) {
  return Math.ceil((42 + 230 * numInputs + 172 * numOutputs) / 4)
}

export async function buildTransaction(inputs, outputs, privkeyBytes) {
  const internalXOnly = privkeyToXOnly(privkeyBytes)
  const { tweakedPriv } = await getTweakedKeys(privkeyBytes)
  const untweakedHex = '5120' + bytesToHex(internalXOnly)
  const signingKey = bytesToHex(inputs[0].scriptPubKey) === untweakedHex ? privkeyBytes : tweakedPriv

  const version = 2, locktime = 0, sequence = 0xfffffffd

  const serOutputs = outputs.map(o =>
    concatBytes(writeU64LE(o.amount), writeVarInt(o.scriptPubKey.length), o.scriptPubKey)
  )

  const shaPrevouts = await sha256(concatBytes(...inputs.map(i =>
    concatBytes(reverseTxid(i.txid), writeU32LE(i.vout))
  )))
  const shaAmounts = await sha256(concatBytes(...inputs.map(i => writeU64LE(i.amount))))
  const shaScriptPubKeys = await sha256(concatBytes(...inputs.map(i =>
    concatBytes(writeVarInt(i.scriptPubKey.length), i.scriptPubKey)
  )))
  const shaSequences = await sha256(concatBytes(...inputs.map(() => writeU32LE(sequence))))
  const shaOutputs = await sha256(concatBytes(...serOutputs))

  const sigs = []
  for (let i = 0; i < inputs.length; i++) {
    const sigMsg = concatBytes(
      new Uint8Array([0x00, 0x00]),
      writeU32LE(version), writeU32LE(locktime),
      shaPrevouts, shaAmounts, shaScriptPubKeys, shaSequences, shaOutputs,
      new Uint8Array([0x00]),
      writeU32LE(i)
    )
    const sighash = await taggedHash('TapSighash', sigMsg)
    sigs.push(schnorr.sign(sighash, signingKey))
  }

  const parts = [
    writeU32LE(version),
    new Uint8Array([0x00, 0x01]),
    writeVarInt(inputs.length)
  ]
  for (const inp of inputs) {
    parts.push(reverseTxid(inp.txid), writeU32LE(inp.vout), new Uint8Array([0x00]), writeU32LE(sequence))
  }
  parts.push(writeVarInt(outputs.length))
  for (const so of serOutputs) parts.push(so)
  for (const sig of sigs) {
    parts.push(new Uint8Array([0x01]), writeVarInt(sig.length), sig)
  }
  parts.push(writeU32LE(locktime))
  return bytesToHex(concatBytes(...parts))
}

// ── Mempool API ─────────────────────────────────────────

const MEMPOOL = 'https://mempool.space/testnet4/api'

export async function fetchUtxos(address) {
  const res = await fetch(MEMPOOL + '/address/' + address + '/utxo')
  if (!res.ok) throw new Error('Mempool API error: ' + res.status)
  return res.json()
}

export async function checkOutspend(txid, vout) {
  try {
    const res = await fetch(MEMPOOL + '/tx/' + txid + '/outspend/' + vout)
    if (!res.ok) return null
    return res.json()
  } catch { return null }
}

export async function fetchTxDetails(txid) {
  const res = await fetch(MEMPOOL + '/tx/' + txid)
  if (!res.ok) throw new Error('Failed to fetch tx: ' + res.status)
  return res.json()
}

export async function broadcastTx(rawTxHex) {
  const res = await fetch(MEMPOOL + '/tx', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: rawTxHex
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(err)
  }
  return res.text()
}

export async function getFeeRate() {
  try {
    const res = await fetch(MEMPOOL + '/v1/fees/recommended')
    if (!res.ok) return 2
    const data = await res.json()
    return data.fastestFee || data.halfHourFee || 2
  } catch { return 2 }
}

// ── TXO URI helpers ─────────────────────────────────────

export function toSats(amount) {
  if (!amount) return 0
  if (Number.isInteger(amount) && amount >= 1) return amount
  const converted = Math.round(amount * 1e8)
  if (converted > 2_100_000_000_000_000) return Math.round(amount)
  return converted
}

export function buildTxoUri(v) {
  const base = 'txo:btc:' + v.txid + ':' + v.vout
  const params = []
  if (v.amount) params.push('amount=' + v.amount)
  if (v.privkey) params.push('key=' + v.privkey)
  return params.length ? base + '?' + params.join('&') : base
}

export function parseVoucherFromItem(item) {
  var txoUri = item['schema:identifier'] || ''
  var txid = '', vout = 0, amount = 0, privkey = ''
  if (txoUri) {
    try {
      var parsed = parseTxoUri(txoUri)
      txid = parsed.txid || ''
      vout = parsed.output || 0
      amount = toSats(parsed.amount)
      privkey = parsed.privkey || parsed.key || ''
    } catch {
      try {
        var parts = txoUri.split('?')
        var segs = parts[0].replace(/^txo:/, '').split(':')
        if (segs.length >= 3) { txid = segs[1] || ''; vout = parseInt(segs[2]) || 0 }
        if (parts[1]) {
          var params = new URLSearchParams(parts[1])
          if (params.has('amount')) amount = toSats(parseFloat(params.get('amount')))
          if (params.has('key')) privkey = params.get('key')
        }
      } catch {}
    }
  }
  return {
    id: item['@id'] || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    txid: txid,
    vout: vout,
    amount: amount,
    privkey: privkey,
    address: item['schema:address'] || '',
    network: 'btc',
    status: item['schema:status'] || 'unknown',
    dateAdded: item['schema:dateCreated'] || new Date().toISOString()
  }
}

export { parseTxoUri, isValidTxoUri, formatTxoUri }
