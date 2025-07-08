const axios = require('axios');
const fs = require('fs');
const https = require('https');
const readline = require('readline');
const path = require('path');

const SHOP = 'sm-dream.myshopify.com';
const TOKEN = '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';

const client = axios.create({
  baseURL: `https://${SHOP}/admin/api/2024-01/graphql.json`,
  headers: {
    'X-Shopify-Access-Token': TOKEN,
    'Content-Type': 'application/json',
  },
});

const BULK_QUERY = `
mutation {
  bulkOperationRunQuery(
    query: """
    {
      customers {
        edges {
          node {
            id
            email
            tags
          }
        }
      }
    }
    """
  ) {
    bulkOperation {
      id
      status
    }
    userErrors {
      field
      message
    }
  }
}
`;

const TIER_TAGS = ['specialist', 'pro', 'elite', 'master', 'luxe', 'diamond'];

async function startBulkQuery() {
  const res = await client.post('', { query: BULK_QUERY });
  const { userErrors } = res.data.data.bulkOperationRunQuery;

  if (userErrors.length) {
    console.error('❌ User errors:', userErrors);
    process.exit(1);
  }

  console.log('✅ Bulk operation started.');
}

async function pollBulkStatus() {
  while (true) {
    const res = await client.post('', {
      query: `
      {
        currentBulkOperation {
          id
          status
          url
          errorCode
        }
      }`,
    });

    const op = res.data.data.currentBulkOperation;
    console.log(`🔄 Status: ${op.status}`);

    if (op.status === 'COMPLETED') return op.url;
    if (op.status === 'FAILED') throw new Error('❌ Bulk operation failed');

    await new Promise((r) => setTimeout(r, 5000));
  }
}

async function downloadAndProcessResults(url) {
  const outputPath = path.join(__dirname, 'bulk_results_cleanup.jsonl');
  const writer = fs.createWriteStream(outputPath);

  await new Promise((resolve, reject) => {
    https.get(url, (res) => {
      res.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  });

  console.log('⬇️  Download complete. Processing...');

  const rl = readline.createInterface({
    input: fs.createReadStream(outputPath),
    crlfDelay: Infinity,
  });

  let lineCount = 0;

  for await (const line of rl) {
    lineCount++;
    if (!line.trim()) {
      console.log(`⚠️ Empty line at ${lineCount}, skipping.`);
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      console.warn(`⚠️ Invalid JSON at line ${lineCount}:`, line);
      continue;
    }

    const node = parsed;

    if (!node.id || !node.tags) {
      console.warn(`⚠️ Missing ID or tags at line ${lineCount}:`, node);
      continue;
    }

    console.log(`🔍 Processing customer ${node.id} with tags:`, node.tags);

    try {
      await cleanUpTierTags(node.id, node.tags);
    } catch (e) {
      console.error(`❌ Error cleaning ${node.email || node.id}:`, e.message);
    }

    await new Promise((r) => setTimeout(r, 300)); // Shopify safe delay
  }

  console.log('✅ Tag cleanup complete.');
}

async function cleanUpTierTags(customerId, currentTags) {
  const normalizedTags = currentTags.map(tag => tag.toLowerCase());
  const hasPlatinum = normalizedTags.includes('diamond');
  if (!hasPlatinum) {
    console.log(`⏭️  Skipping ${customerId}, no diamond tag.`);
    return;
  }

  // Keep only non-tier tags or 'platinum'
  const cleanedTags = currentTags.filter(tag => {
    const lower = tag.toLowerCase();
    return !TIER_TAGS.includes(lower) || lower === 'diamond';
  });

  const combinedTags = cleanedTags.join(', ');

  const mutation = `
    mutation {
      customerUpdate(input: {
        id: "${customerId}",
        tags: "${combinedTags}"
      }) {
        userErrors {
          field
          message
        }
      }
    }
  `;

  const res = await client.post('', { query: mutation });
  const errors = res.data.data.customerUpdate.userErrors;

  if (errors.length) {
    throw new Error(JSON.stringify(errors));
  } else {
    console.log(`✅ Cleaned up tags for ${customerId}`);
  }
}

// 🚀 Run the full flow
(async () => {
  try {
    await startBulkQuery();
    const url = await pollBulkStatus();
    console.log('📦 Bulk result URL:', url);
    await downloadAndProcessResults(url);
  } catch (err) {
    console.error('❌ Script failed:', err.message);
  }
})();
