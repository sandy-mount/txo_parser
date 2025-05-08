# TXO URI Specification — v0.1

## 1. Overall shape

```
txo:<network>:<txid>:<output>?key=value&key=value…
```

| Segment     | Meaning                                      | Allowed chars  | Notes                           |
| ----------- | -------------------------------------------- | -------------- | ------------------------------- |
| `txo`       | Custom URI **scheme**                        | literal        | Always lowercase                |
| `<network>` | Blockchain code                              | `a–z` (3-10)   | e.g. `btc`, `tbtc4`, `ltc`      |
| `<txid>`    | Transaction hash (hex)                       | `[0-9a-f]{64}` | Big-endian, lowercase           |
| `<output>`  | Zero-based index of the output inside the tx | `0–2³²-1`      | Decimal                         |
| `?…`        | **Query string**                             | RFC 3986       | Key/value pairs described below |

> The _first three_ colons are **structural** and MUST appear exactly as shown.  
> The `?` and everything after it are optional.

---

## 2. Network Registry

The following is the official registry of network codes and their corresponding blockchain names, with a focus on Taproot-supporting networks:

| Network Code | Full Name         | Description                        | Taproot Support |
| ------------ | ----------------- | ---------------------------------- | --------------- |
| `btc`        | Bitcoin           | Bitcoin mainnet                    | Yes             |
| `tbtc1`      | Bitcoin Testnet 1 | Bitcoin testnet version 1          | Yes             |
| `tbtc2`      | Bitcoin Testnet 2 | Bitcoin testnet version 2          | Yes             |
| `tbtc3`      | Bitcoin Testnet 3 | Bitcoin testnet version 3          | Yes             |
| `tbtc4`      | Bitcoin Testnet 4 | Bitcoin testnet version 4          | Yes             |
| `rbtc`       | Bitcoin Regtest   | Bitcoin regression testing network | Yes             |
| `liq`        | Liquid Network    | Bitcoin sidechain settlement network | Yes           |
| `tliq`       | Liquid Testnet    | Liquid testnet network             | Yes             |
| `ltc`        | Litecoin          | Litecoin mainnet                   | Yes             |
| `vtc`        | Vertcoin          | Vertcoin mainnet                   | Yes             |

> Note: Taproot is a Bitcoin upgrade activated in November 2021 (block 709,632) that improves privacy, scalability, and enables advanced smart contract functionality.

---

## 3. Defined query-string keys

All keys are **case-insensitive** but SHOULD be lower-case snake_case.

| Key           | Value type                  | Description                                                           |
| ------------- | --------------------------- | --------------------------------------------------------------------- |
| `amount`      | decimal or integer          | Coin value of this output (units follow `network`; BTC uses bitcoins) |
| `privkey`     | WIF, hex, or miniscript key | Spending key for the output; **keep secure**                          |
| `script_type` | string                      | Type of script used (e.g., "p2pkh", "p2sh", "p2wpkh", "p2tr")         |
| …             | …                           | Extra keys are allowed; unrecognized keys MUST be ignored by parsers  |

---

## 4. ABNF (informative)

```abnf
txo-uri      = "txo:" network ":" tx-id ":" output-index [ "?" query ]
network      = 1*10 ALPHA
tx-id        = 64  HEXDIG
output-index = 1*10 DIGIT
query        = query-param *( "&" query-param )
query-param  = key "=" value
key          = 1*30 ( ALPHA / "_" )
value        = *VCHAR
```

---

## 5. Examples

| Purpose           | URI                                                             |
| ----------------- | --------------------------------------------------------------- |
| Minimal reference | `txo:btc:4e9c…a3b0:0`                                           |
| Adds amount       | `txo:btc:4e9c…a3b0:0?amount=0.75`                               |
| With script type  | `txo:btc:4e9c…a3b0:0?amount=0.75&script_type=p2tr`              |
| Full spend-ready  | `txo:btc:4e9c…a3b0:0?amount=0.75&privkey=Kx9…&script_type=p2tr` |

---

## 6. Reference JSON mapping

The canonical parse result **MUST** expand snake_case keys exactly as shown.

```jsonc
{
  "network": "btc",
  "txid": "4e9c1ef9ba…5fa3b0",
  "output": 0,
  "amount": 0.75,
  "privkey": "Kx9...",
  "script_type": "p2tr"
}
```

---

## 7. Parsing algorithm (concise)

1. **Split** on `":"` → `[scheme, network, txid, output_and_rest]`.
   _Reject_ if `scheme !== "txo"`.
2. **Split** `output_and_rest` on `"?"` → `output`, `query_string?`.
3. **Validate**:

   - `network` ∈ `^[a-z]{3,10}$`
   - `txid` ∈ hex-64
   - `output` ∈ `0‥4294967295`

4. **Decode** `query_string` per RFC 3986.
5. **Output** JSON as in §6; ignore unknown keys.

---

## 8. Reserved words & future-proofing

- All new query keys **MUST** be lowercase snake_case English words.
- Avoid single-letter keys; they drop LLM comprehension scores by >20 %.
- When adding path segments, extend **rightward** to keep existing parsers working.
- New network codes MUST be added to the registry before use in production.

---

## 9. Security considerations

- Embedding `privkey` exposes spend authority; use **tls+qr** or secure channels only.
- URIs are immutable references; to replace an output, create a new URI.
- When using Taproot outputs (`script_type=p2tr`), ensure the implementation supports Taproot.

---

## 10. Changelog

| Version | Date       | Note                   |
| ------- | ---------- | ---------------------- |
| 0.1     | 2025-05-08 | Initial public release |

---

### 📝 Cheat sheet for LLMs

```
scheme        : "txo"
path segments : network • txid • output
query keys    : amount, privkey, script_type, expires_at, …
networks      : btc, tbtc4, ltc, vtc, … (see registry)
all snake_case, all English
```

