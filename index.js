/**
 * TXO URI Parser
 * Implementation of the TXO URI Specification (v0.1)
 * 
 * Format: txo:<network>:<txid>:<output>?key=value&key=value...
 * Legacy Format: txo:<network>:<txid>:<output> [amount] [privkey]
 */

/**
 * Parse a TXO URI and return a JSON object
 * @param {string} uri - The TXO URI to parse
 * @returns {object} - Parsed result as JSON
 * @throws {Error} - If URI format is invalid
 */
export function parseTxoUri (uri) {
  if (!uri || typeof uri !== 'string') {
    throw new Error('Invalid URI: URI must be a non-empty string');
  }

  // Check if this is using the legacy space-separated format
  const isLegacyFormat = !uri.includes('?') && uri.split(' ').length > 1;

  // Parse the basic structure first
  let basicParts;
  let extraParts = [];

  if (isLegacyFormat) {
    const allParts = uri.split(' ');
    basicParts = allParts[0].split(':');
    extraParts = allParts.slice(1);
  } else {
    basicParts = uri.split(':');
  }

  const [scheme, network, txid, outputAndRest] = basicParts;

  // Validate scheme
  if (scheme !== 'txo') {
    throw new Error('Invalid URI: Scheme must be "txo"');
  }

  // Validate network (allow lowercase letters and digits, 3-10 chars)
  // Updated to match the specification - at least one letter and can include numbers
  if (!network || !/^[a-z][a-z0-9]{2,9}$/.test(network)) {
    throw new Error('Invalid URI: Network must be 3-10 characters (lowercase letters and digits), starting with a letter');
  }

  // Validate txid
  if (!txid || !/^[0-9a-f]{64}$/.test(txid)) {
    throw new Error('Invalid URI: TXID must be a 64-character lowercase hexadecimal');
  }

  if (!outputAndRest) {
    throw new Error('Invalid URI: Missing output index');
  }

  // Split the output and query string
  let output, queryString;
  if (!isLegacyFormat && outputAndRest.includes('?')) {
    [output, queryString] = outputAndRest.split('?');
  } else {
    output = outputAndRest;
    queryString = '';
  }

  // Validate output
  const outputNum = parseInt(output, 10);
  if (isNaN(outputNum) || outputNum < 0 || outputNum > 4294967295 || !/^\d+$/.test(output)) {
    throw new Error('Invalid URI: Output must be a non-negative integer (0-4294967295)');
  }

  // Parse query string
  const queryParams = {};
  if (queryString) {
    const params = queryString.split('&');
    params.forEach(param => {
      if (param.includes('=')) {
        const [key, value] = param.split('=');
        // Convert key to lowercase for case-insensitivity
        const normalizedKey = key.toLowerCase();

        // Process specific key types
        if (normalizedKey === 'amount') {
          // Parse amount as a number
          const amount = parseFloat(value);
          if (!isNaN(amount)) {
            queryParams[normalizedKey] = amount;
          } else {
            queryParams[normalizedKey] = value;
          }
        } else {
          queryParams[normalizedKey] = value;
        }
      }
    });
  }

  // Handle legacy format with space-separated parameters
  if (isLegacyFormat && extraParts.length > 0) {
    // First extra part is amount
    if (extraParts[0]) {
      const amount = parseFloat(extraParts[0]);
      if (!isNaN(amount)) {
        queryParams.amount = amount;
      }
    }

    // Second extra part is privkey
    if (extraParts.length > 1 && extraParts[1]) {
      queryParams.privkey = extraParts[1];
    }
  }

  // Build the result object
  const result = {
    network,
    txid,
    output: outputNum,
    ...queryParams
  };

  return result;
}

/**
 * Validates if a string is a valid TXO URI
 * @param {string} uri - The URI to validate
 * @returns {boolean} - True if valid, false otherwise
 */
export function isValidTxoUri (uri) {
  try {
    parseTxoUri(uri);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Formats a JSON object into a TXO URI
 * @param {object} data - The data to format
 * @returns {string} - The formatted TXO URI
 * @throws {Error} - If required fields are missing or invalid
 */
export function formatTxoUri (data) {
  // Validate required fields
  if (!data.network || !data.txid || data.output === undefined) {
    throw new Error('Missing required fields: network, txid, and output are required');
  }

  // Validate network (allow lowercase letters and digits, 3-10 chars)
  if (!data.network || !/^[a-z][a-z0-9]{2,9}$/.test(data.network)) {
    throw new Error('Invalid network: must be 3-10 characters (lowercase letters and digits), starting with a letter');
  }

  // Validate txid
  if (!/^[0-9a-f]{64}$/.test(data.txid)) {
    throw new Error('Invalid txid: must be a 64-character lowercase hexadecimal');
  }

  // Validate output
  const output = parseInt(data.output, 10);
  if (isNaN(output) || output < 0 || output > 4294967295) {
    throw new Error('Invalid output: must be a non-negative integer (0-4294967295)');
  }

  // Build the base URI
  let uri = `txo:${data.network}:${data.txid}:${output}`;

  // Add query parameters
  const queryParams = [];
  Object.entries(data).forEach(([key, value]) => {
    if (!['network', 'txid', 'output'].includes(key) && value !== undefined) {
      queryParams.push(`${key.toLowerCase()}=${encodeURIComponent(value)}`);
    }
  });

  if (queryParams.length > 0) {
    uri += `?${queryParams.join('&')}`;
  }

  return uri;
} 