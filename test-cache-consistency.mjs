#!/usr/bin/env zx

// Cache consistency test script for Cloudflare Worker
// Tests cache across different PIA VPN locations

import { $, chalk, argv, fs, path } from 'zx';

$.verbose = false;

// Your domain
const DOMAIN = argv._[0] || argv.domain || 'https://ultimatehackingkeyboard.com';
const CACHE_DEBUG_URL = `${DOMAIN}/cache-debug`;
const OUTPUT_DIR = './cache-test-results';
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

// PIA VPN regions to test (edit as needed)
// Run 'piactl get regions' to see all available regions
const REGIONS = [
  'us-east',
  'us-west',
  'us-chicago',
  'us-texas',
  'uk-london',
  'uk-manchester',
  'de-frankfurt',
  'de-berlin',
  'france',
  'netherlands',
  'au-sydney',
  'au-melbourne',
  'singapore',
  'jp-tokyo',
  'hong-kong',
  'india',
  'brazil',
  'south-africa',
  'ca-ontario',
];

console.log('============================================');
console.log('Cloudflare Cache Consistency Test');
console.log('============================================');
console.log(`Domain: ${DOMAIN}`);
console.log(`Timestamp: ${TIMESTAMP}`);
console.log('');

// Create output directory
await fs.ensureDir(OUTPUT_DIR);

// Check if piactl is available
try {
  await $`which piactl`;
} catch {
  console.log(chalk.red('Error: piactl not found. Please install PIA VPN client.'));
  process.exit(1);
}

// Disconnect from VPN first
console.log('Disconnecting from VPN...');
await $`piactl disconnect`.quiet();
await sleep(2000);

// Test without VPN first
console.log(chalk.yellow('Testing from local connection (no VPN)...'));
const localOutput = path.join(OUTPUT_DIR, `local_${TIMESTAMP}.json`);

try {
  // Get local IP
  const localIPResponse = await fetch('https://api.ipify.org');
  const localIP = await localIPResponse.text();
  console.log(`  Current IP: ${localIP}`);

  const response = await fetch(CACHE_DEBUG_URL);
  const data = await response.json();
  await fs.writeJSON(localOutput, data, { spaces: 2 });

  console.log(chalk.green('✓ Local test completed'));
  console.log(`  Edge location: ${data.edgeLocation.colo}`);
} catch (error) {
  console.log(chalk.red('✗ Local test failed'));
  console.log(`  Error: ${error.message}`);
}

console.log('');

// Test from each VPN region
const results = [];

  for (const region of REGIONS) {
    console.log(chalk.yellow(`Testing from region: ${region}`));

    try {
      // Connect to VPN
      console.log('  Connecting to VPN...');
      await $`piactl set region ${region}`.quiet();
      await $`piactl connect`.quiet();

      // Wait for routing to establish
      await sleep(5000);

      // Get current IP to verify VPN connection with retry
      let currentIP;
      let fetchSuccess = false;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const ipResponse = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(5000) });
          currentIP = await ipResponse.text();
          fetchSuccess = true;
          break;
        } catch (e) {
          if (attempt < 2) {
            console.log(`  Retry attempt ${attempt + 1}...`);
            await sleep(2000);
          }
        }
      }

      if (!fetchSuccess) {
        throw new Error('Failed to verify IP after 3 attempts');
      }

      console.log(`  Current IP: ${currentIP}`);

      // Also get VPN IP from piactl to compare
      const vpnIP = (await $`piactl get vpnip`.quiet()).stdout.trim();
      console.log(`  VPN IP: ${vpnIP}`);

      // Fetch cache debug info
      const outputFile = path.join(OUTPUT_DIR, `${region}_${TIMESTAMP}.json`);
      const response = await fetch(CACHE_DEBUG_URL, { signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      await fs.writeJSON(outputFile, data, { spaces: 2 });

      console.log(chalk.green('  ✓ Test completed'));
      console.log(`  Edge location: ${data.edgeLocation.colo}`);
      console.log(`  Cached pages: ${data.cachedPageCount}`);

      results.push({
        region,
        file: outputFile,
        data,
      });
    } catch (error) {
      console.log(chalk.red(`  ✗ Test failed: ${error.message}`));
    }

  // Disconnect
  await $`piactl disconnect`.quiet();

  console.log('');
}

console.log('============================================');
console.log('Analysis');
console.log('============================================');
console.log('');

// Compare hashes across all results
console.log('Comparing cache hashes across locations...');
console.log('');

// Load all result files
const allResults = [];
const resultFiles = await fs.readdir(OUTPUT_DIR);

for (const file of resultFiles) {
  if (file.endsWith(`_${TIMESTAMP}.json`)) {
    const filePath = path.join(OUTPUT_DIR, file);
    const data = await fs.readJSON(filePath);
    const location = file.replace(`_${TIMESTAMP}.json`, '');
    allResults.push({ location, data });
  }
}

// Get all unique pages
const allPages = new Set();
for (const result of allResults) {
  if (result.data.pages) {
    for (const page of Object.keys(result.data.pages)) {
      allPages.add(page);
    }
  }
}

// Compare each page across locations
let foundInconsistency = false;

for (const page of Array.from(allPages).sort()) {
  console.log(`Page: ${page}`);
  console.log('----------------------------------------');

  const hashes = [];
  const hashMap = new Map(); // hash -> locations

  for (const result of allResults) {
    const edge = result.data.edgeLocation?.colo || 'unknown';
    const pageData = result.data.pages?.[page];

    if (pageData && pageData.hash) {
      const hash = pageData.hash;
      console.log(`  ${result.location} (${edge}): ${hash}`);
      hashes.push(hash);

      if (!hashMap.has(hash)) {
        hashMap.set(hash, []);
      }
      hashMap.get(hash).push(`${result.location} (${edge})`);
    } else {
      console.log(`  ${result.location} (${edge}): ${chalk.red('NOT CACHED')}`);
    }
  }

  // Check for inconsistencies
  const uniqueHashes = new Set(hashes);

  if (uniqueHashes.size > 1) {
    console.log(chalk.red(`  ⚠ INCONSISTENT: Found ${uniqueHashes.size} different versions!`));
    console.log('');
    console.log('  Version distribution:');
    for (const [hash, locations] of hashMap.entries()) {
      console.log(`    ${hash}: ${locations.join(', ')}`);
    }
    foundInconsistency = true;
  } else if (uniqueHashes.size === 1) {
    console.log(chalk.green('  ✓ Consistent across all locations'));
  }

  console.log('');
}

console.log('============================================');
console.log(`Results saved to: ${OUTPUT_DIR}`);
console.log('============================================');

if (foundInconsistency) {
  console.log('');
  console.log(chalk.red('⚠ Cache inconsistencies detected!'));
  process.exit(1);
} else {
  console.log('');
  console.log(chalk.green('✓ All caches are consistent'));
}
