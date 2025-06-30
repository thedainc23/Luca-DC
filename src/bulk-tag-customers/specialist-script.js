const axios = require('axios');
const fs = require('fs');
const https = require('https');
const readline = require('readline');
const path = require('path');

const SHOP = 'sm-dream.myshopify.com';
const TOKEN = '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';
const TAG_TO_ADD = 'specialist';

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
            amountSpent {
              amount
              currencyCode
            }
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
  const outputPath = path.join(__dirname, 'bulk_results.jsonl');
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

  for await (const line of rl) {
    if (!line.trim()) continue;

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      console.warn('⚠️ Skipping invalid JSON:', line);
      continue;
    }

    const node = parsed;

    if (!node.id) {
      console.warn('⚠️ Skipping row without ID:', line);
      continue;
    }

    const amountSpent = parseFloat(node.amountSpent?.amount || '0');
    if (amountSpent < 5000) continue;

    try {
      await updateCustomerTag(node.id, node.tags || []);
    } catch (e) {
      console.error(`❌ Error tagging ${node.email || node.id}:`, e.message);
    }

    await new Promise((r) => setTimeout(r, 300)); // Shopify rate limiting
  }

  console.log('✅ All qualifying customers processed.');
}

async function updateCustomerTag(customerId, currentTags) {
  const tagSet = new Set(currentTags);
  tagSet.add(TAG_TO_ADD);
  const combinedTags = Array.from(tagSet).join(', ');

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
    console.log(`🏷️  Tagged ${customerId} with "${TAG_TO_ADD}"`);
  }
}

// Run everything
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
