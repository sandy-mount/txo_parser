#!/usr/bin/env node

/**
 * TXO URI Parser CLI
 * 
 * A command-line interface for the TXO URI parser
 * Usage: txo-parser <uri> [options]
 * 
 * Options:
 *   --<field>    Output only the specified field (e.g., --txid, --network, --output)
 *   --help       Show help
 */

import { parseTxoUri, isValidTxoUri } from './index.js';

const args = process.argv.slice(2);

// Help message
function showHelp () {
  console.log(`
TXO URI Parser CLI

Parse TXO URIs from the command line and output JSON or specific fields.

Usage: 
  txo-parser <uri> [options]

Options:
  --<field>    Output only the specified field (e.g., --txid, --network, --output)
  --help       Show this help message

Examples:
  txo-parser "txo:btc:4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb:0"
  txo-parser "txo:btc:4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb:0?amount=0.75" --txid
  txo-parser "txo:btc:4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb:0" --network
  `);
}

// Check for help
if (args.includes('--help') || args.length === 0) {
  showHelp();
  process.exit(0);
}

// Get the URI and options
const uri = args[0];
const options = args.slice(1);

try {
  // Parse the URI
  if (!isValidTxoUri(uri)) {
    console.error('Error: Invalid TXO URI');
    process.exit(1);
  }

  const parsed = parseTxoUri(uri);

  // Check if a specific field was requested
  if (options.length > 0) {
    for (const option of options) {
      if (option.startsWith('--')) {
        const field = option.substring(2);
        if (parsed[field] !== undefined) {
          console.log(parsed[field]);
          process.exit(0);
        } else {
          console.error(`Error: Field "${field}" not found in parsed URI`);
          process.exit(1);
        }
      }
    }
  } else {
    // Output the full JSON
    console.log(JSON.stringify(parsed, null, 2));
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
} 