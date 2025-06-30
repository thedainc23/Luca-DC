const axios = require('axios');
const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');

const SHOP = 'sm-dream.myshopify.com';
const TOKEN = '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';
const TAG_TO_ADD = 'vip';

const client = axios.create({
  baseURL: `https://${SHOP}/admin/api/2024-01/graphql.json`,
  headers: {
    'X-Shopify-Access-Token': TOKEN,
    'Content-Type': 'application/json',
  },
});

async function getDownloadUrl() {
  const query = `
    {
      currentBulkOperation {
        url
        status
        completedAt
      }
    }
  `;

  const response = await client.post('', { query });
  return response.data.data.currentBulkOperation.url;
}

async function processFile() {
  const url = await getDownloadUrl();
  console.log('📦 Downloading:', url);

  const res = await axios.get(url, { responseType: 'stream' });
  const rl = readline.createInterface({
    input: res.data.pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });

  const updates = [];

  for await (const line of rl) {
    const customer = JSON.parse(line);
    const currentTags = (customer.tags || '').split(',').map(t => t.trim());
    if (!currentTags.includes(TAG_TO_ADD)) {
      currentTags.push(TAG_TO_ADD);
    }

    updates.push({
      id: customer.id,
      tags: currentTags.join(', '),
    });
  }

  // Write to file for next step
  fs.writeFileSync('updates.ndjson', updates.map(u => JSON.stringify({
    id: u.id,
    tags: u.tags
  })).join('\n'));

  console.log(`✅ Prepared ${updates.length} updates.`);
}

processFile().catch(console.error);
