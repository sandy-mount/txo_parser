# TXO URI Parser

A pure JavaScript ES module for parsing and formatting TXO URIs according to the [TXO URI Specification v0.1](txo_uri.md).

## Installation

```bash
npm install txo_parser
```

For global installation (to use the CLI):

```bash
npm install -g txo_parser
```

## Usage

### As a Module

```javascript
import { parseTxoUri, isValidTxoUri, formatTxoUri } from 'txo_parser'

// Parse a TXO URI
const uri =
  'txo:btc:4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0:0?amount=0.75'
const parsed = parseTxoUri(uri)
console.log(parsed)
// Output:
// {
//   network: 'btc',
//   txid: '4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0',
//   output: 0,
//   amount: 0.75
// }

// Parse legacy format
const legacyUri =
  'txo:btc:4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0:0 0.75 Kx9'
const parsedLegacy = parseTxoUri(legacyUri)
console.log(parsedLegacy)
// Output:
// {
//   network: 'btc',
//   txid: '4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0',
//   output: 0,
//   amount: 0.75,
//   privkey: 'Kx9'
// }

// Check if a URI is valid
console.log(isValidTxoUri(uri)) // true

// Format a JSON object into a TXO URI
const data = {
  network: 'btc',
  txid: '4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0',
  output: 0,
  amount: 0.75,
  script_type: 'p2tr'
}
const formattedUri = formatTxoUri(data)
console.log(formattedUri)
// Output: txo:btc:4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0:0?amount=0.75&script_type=p2tr
```

### Using the CLI

The package includes a command-line tool that allows you to parse TXO URIs directly from the terminal:

```bash
# Parse a TXO URI and output the full JSON
txo-parser "txo:btc:4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0:0?amount=0.75"

# Parse legacy format
txo-parser "txo:btc:4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0:0 0.75 Kx9"

# Extract just the txid
txo-parser "txo:btc:4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0:0" --txid

# Extract the network
txo-parser "txo:btc:4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0:0" --network

# Get help
txo-parser --help
```

If you haven't installed the package globally, you can use `npx`:

```bash
npx txo-parser "txo:btc:4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0:0"
```

## Supported Formats

The parser supports two formats:

1. **Standard Format** (as per specification):  
   `txo:<network>:<txid>:<output>?key=value&key=value...`

2. **Legacy Format**:  
   `txo:<network>:<txid>:<output> [amount] [privkey]`

The legacy format supports up to two space-separated parameters after the basic structure:

- First parameter is interpreted as the amount
- Second parameter is interpreted as the private key

## API

### `parseTxoUri(uri)`

Parses a TXO URI string and returns a JSON object.

- **Parameters:**
  - `uri` (string): The TXO URI to parse
- **Returns:** Object with parsed components
- **Throws:** Error if URI format is invalid

### `isValidTxoUri(uri)`

Checks if a string is a valid TXO URI.

- **Parameters:**
  - `uri` (string): The URI to validate
- **Returns:** Boolean indicating validity

### `formatTxoUri(data)`

Formats a JSON object into a TXO URI string.

- **Parameters:**
  - `data` (object): The data to format (must include network, txid, and output)
- **Returns:** Formatted TXO URI string (always in standard format)
- **Throws:** Error if required fields are missing or invalid

## Testing

Run tests with:

```bash
npm test
```

## Using in Node.js Projects

If you're using this in a Node.js project, make sure your package.json includes:

```json
{
  "type": "module"
}
```

Or when importing in a CommonJS project:

```javascript
import { parseTxoUri } from 'txo_parser/index.js'
```

## License

MIT
