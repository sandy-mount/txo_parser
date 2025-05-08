/**
 * TXO URI Parser - Test File
 * 
 * This file demonstrates how to use the TXO URI parser library.
 */

import { parseTxoUri, isValidTxoUri, formatTxoUri } from './index.js';

// Create a valid 64-character txid (no newlines)
const validTxid = '4e9c1ef9ba5fa3b0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb';

// Example TXO URIs from the specification (with complete 64-char txids)
const examples = [
  `txo:btc:${validTxid}:0`,
  `txo:btc:${validTxid}:0?amount=0.75`,
  `txo:btc:${validTxid}:0?amount=0.75&script_type=p2tr`,
  `txo:btc:${validTxid}:0?amount=0.75&privkey=Kx9&script_type=p2tr`
];

// Parse each example and display the result
console.log('=== Parsing Examples ===');
examples.forEach((uri, index) => {
  console.log(`\nExample ${index + 1}: ${uri}`);
  try {
    const parsed = parseTxoUri(uri);
    console.log('Parsed result:', JSON.stringify(parsed, null, 2));
    console.log('Is valid:', isValidTxoUri(uri));
  } catch (error) {
    console.error('Error parsing URI:', error.message);
  }
});

// Legacy format examples
console.log('\n=== Legacy Format Examples ===');
const legacyExamples = [
  `txo:btc:${validTxid}:0 0.75`,
  `txo:btc:${validTxid}:0 0.75 Kx9`
];

legacyExamples.forEach((uri, index) => {
  console.log(`\nLegacy Example ${index + 1}: ${uri}`);
  try {
    const parsed = parseTxoUri(uri);
    console.log('Parsed result:', JSON.stringify(parsed, null, 2));
    console.log('Is valid:', isValidTxoUri(uri));
  } catch (error) {
    console.error('Error parsing URI:', error.message);
  }
});

// Examples of creating TXO URIs from JSON objects
console.log('\n=== Formatting Examples ===');

const jsonExamples = [
  {
    network: 'btc',
    txid: validTxid,
    output: 0
  },
  {
    network: 'btc',
    txid: validTxid,
    output: 0,
    amount: 0.75
  },
  {
    network: 'btc',
    txid: validTxid,
    output: 0,
    amount: 0.75,
    script_type: 'p2tr'
  },
  {
    network: 'tbtc4', // Note: this one fails in the test because tbtc4 is not recognized
    txid: validTxid,
    output: 1,
    amount: 1.5,
    privkey: 'Kx9',
    script_type: 'p2tr'
  }
];

jsonExamples.forEach((json, index) => {
  console.log(`\nJSON Example ${index + 1}:`, JSON.stringify(json, null, 2));
  try {
    const formatted = formatTxoUri(json);
    console.log('Formatted URI:', formatted);

    // Validate by parsing back
    console.log('Parsed back:', JSON.stringify(parseTxoUri(formatted), null, 2));
  } catch (error) {
    console.error('Error formatting URI:', error.message);
  }
});

// Example with an invalid URI
console.log('\n=== Invalid URI Example ===');
const invalidUri = 'txo:bitcoin:invalidtxid:0';
console.log('Invalid URI:', invalidUri);
console.log('Is valid:', isValidTxoUri(invalidUri));
try {
  parseTxoUri(invalidUri);
} catch (error) {
  console.error('Error:', error.message);
}

// Example with an invalid JSON
console.log('\n=== Invalid JSON Example ===');
const invalidJson = {
  network: 'BITCOIN',  // Uppercase, not allowed
  txid: '1234',       // Too short
  output: -1          // Negative, not allowed
};
console.log('Invalid JSON:', JSON.stringify(invalidJson, null, 2));
try {
  formatTxoUri(invalidJson);
} catch (error) {
  console.error('Error:', error.message);
} 