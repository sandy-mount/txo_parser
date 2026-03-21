import { html, render, onUnmount } from 'https://losos.org/losos/html.js'

export default {
  label: 'Spec',
  icon: '\uD83D\uDCC4',

  canHandle(subject, store) {
    var node = store.get(subject.value)
    var type = node && store.type(node)
    return type && (type.includes('TxoDemo') || type.includes('VoucherPool'))
  },

  render(subject, store, container) {
    render(container, html`
      <style>
        .sp-wrap { padding: 0 16px 40px; max-width: 800px; margin: 0 auto; }
        .sp-hero { text-align: center; padding: 40px 0 28px; }
        .sp-hero-icon { font-size: 3rem; margin-bottom: 8px; }
        .sp-hero-title { font-size: 1.6rem; font-weight: 800; margin-bottom: 4px; }
        .sp-hero-sub { font-size: 0.9rem; color: rgba(255,255,255,0.35); }
        .sp-section { margin-bottom: 32px; }
        .sp-section h2 { font-size: 1.1rem; font-weight: 700; color: rgba(255,255,255,0.9); margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .sp-section h3 { font-size: 0.95rem; font-weight: 600; color: rgba(255,255,255,0.7); margin: 16px 0 8px; }
        .sp-p { font-size: 0.9rem; color: rgba(255,255,255,0.5); line-height: 1.7; margin-bottom: 10px; }
        .sp-code { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 14px 18px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.85rem; color: #10b981; overflow-x: auto; margin: 10px 0 14px; line-height: 1.5; }
        .sp-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; margin: 10px 0 14px; }
        .sp-table th { text-align: left; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.4); font-weight: 600; text-transform: uppercase; font-size: 0.72rem; letter-spacing: 0.05em; }
        .sp-table td { padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.04); color: rgba(255,255,255,0.6); }
        .sp-table td:first-child { font-family: 'SF Mono', monospace; color: #3b82f6; }
        .sp-tag { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 0.75rem; font-family: 'SF Mono', monospace; background: rgba(59,130,246,0.1); border: 1px solid rgba(59,130,246,0.2); color: #3b82f6; }
        .sp-warn { background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2); border-radius: 8px; padding: 12px 16px; font-size: 0.82rem; color: #fbbf24; margin: 10px 0; }
      </style>

      <div class="sp-wrap">
        <div class="sp-hero">
          <div class="sp-hero-icon">\uD83D\uDCC4</div>
          <div class="sp-hero-title">TXO URI Specification</div>
          <div class="sp-hero-sub">v0.2 \u2014 A compact URI scheme for referencing transaction outputs</div>
        </div>

        <div class="sp-section">
          <h2>1. Format</h2>
          <div class="sp-code">txo:&lt;network&gt;:&lt;txid&gt;:&lt;output&gt;?key=value&amp;key=value\u2026</div>
          <table class="sp-table">
            <tr><th>Segment</th><th>Meaning</th><th>Format</th></tr>
            <tr><td>txo</td><td>URI scheme</td><td>literal, lowercase</td></tr>
            <tr><td>&lt;network&gt;</td><td>Blockchain code</td><td>a\u2013z, 3\u201310 chars (e.g. btc, tbtc4)</td></tr>
            <tr><td>&lt;txid&gt;</td><td>Transaction hash</td><td>64-char lowercase hex</td></tr>
            <tr><td>&lt;output&gt;</td><td>Output index</td><td>0\u20134294967295</td></tr>
            <tr><td>?...</td><td>Query string</td><td>RFC 3986 key=value pairs</td></tr>
          </table>
        </div>

        <div class="sp-section">
          <h2>2. Networks</h2>
          <table class="sp-table">
            <tr><th>Code</th><th>Name</th><th>Taproot</th></tr>
            <tr><td>btc</td><td>Bitcoin mainnet</td><td>\u2713</td></tr>
            <tr><td>tbtc4</td><td>Bitcoin Testnet 4</td><td>\u2713</td></tr>
            <tr><td>tbtc3</td><td>Bitcoin Testnet 3</td><td>\u2713</td></tr>
            <tr><td>ltc</td><td>Litecoin</td><td>\u2713</td></tr>
            <tr><td>liq</td><td>Liquid Network</td><td>\u2713</td></tr>
          </table>
        </div>

        <div class="sp-section">
          <h2>3. Query Parameters</h2>
          <table class="sp-table">
            <tr><th>Key</th><th>Type</th><th>Description</th></tr>
            <tr><td>amount</td><td>decimal / integer</td><td>Coin value of output</td></tr>
            <tr><td>privkey</td><td>WIF / hex</td><td>Spending key (canonical)</td></tr>
            <tr><td>key</td><td><em>alias</em></td><td>Alias for privkey; parsers MUST normalize</td></tr>
            <tr><td>script_type</td><td>string</td><td>p2pkh, p2sh, p2wpkh, p2tr</td></tr>
          </table>
          <div class="sp-p">All keys are case-insensitive, SHOULD be lowercase snake_case. Unknown keys MUST be ignored by parsers.</div>
        </div>

        <div class="sp-section">
          <h2>4. Examples</h2>
          <h3>Minimal reference</h3>
          <div class="sp-code">txo:btc:4e9c\u2026a3b0:0</div>
          <h3>With amount</h3>
          <div class="sp-code">txo:btc:4e9c\u2026a3b0:0?amount=0.75</div>
          <h3>Spend-ready (with key alias)</h3>
          <div class="sp-code">txo:btc:4e9c\u2026a3b0:0?amount=0.75&key=Kx9\u2026</div>
          <h3>Full form</h3>
          <div class="sp-code">txo:btc:4e9c\u2026a3b0:0?amount=0.75&privkey=Kx9\u2026&script_type=p2tr</div>
          <h3>Legacy (space-separated)</h3>
          <div class="sp-code">txo:btc:4e9c\u2026a3b0:0 0.75 Kx9\u2026</div>
        </div>

        <div class="sp-section">
          <h2>5. Parsing Algorithm</h2>
          <div class="sp-p">1. Split on <span class="sp-tag">:</span> \u2192 [scheme, network, txid, output_and_rest]. Reject if scheme \u2260 "txo".</div>
          <div class="sp-p">2. Split output_and_rest on <span class="sp-tag">?</span> \u2192 output, query_string.</div>
          <div class="sp-p">3. Validate: network \u2208 [a-z]{3,10}, txid \u2208 hex-64, output \u2208 0\u20134294967295.</div>
          <div class="sp-p">4. Decode query_string per RFC 3986.</div>
          <div class="sp-p">5. Normalize aliases: <span class="sp-tag">key</span> \u2192 <span class="sp-tag">privkey</span>.</div>
          <div class="sp-p">6. Output JSON; ignore unknown keys.</div>
        </div>

        <div class="sp-section">
          <h2>6. Security</h2>
          <div class="sp-warn">\u26A0 Embedding privkey exposes spend authority. Use TLS + QR or secure channels only. URIs are immutable; to replace an output, create a new URI.</div>
        </div>

        <div class="sp-section">
          <h2>7. Install</h2>
          <div class="sp-code">npm install txo_parser</div>
          <div class="sp-code">import { parseTxoUri, formatTxoUri } from 'txo_parser'</div>
        </div>
      </div>
    `)

    onUnmount(container, function() {})
  }
}
