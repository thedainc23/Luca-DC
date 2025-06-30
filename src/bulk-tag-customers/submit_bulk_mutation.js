const axios = require('axios');
const fs = require('fs');

const SHOP = 'sm-dream.myshopify.com';
const TOKEN = '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';

const client = axios.create({
  baseURL: `https://${SHOP}/admin/api/2024-01/graphql.json`,
  headers: {
    'X-Shopify-Access-Token': TOKEN,
    'Content-Type': 'application/json',
  },
});

async function uploadBulkMutation() {
  const mutation = `
    mutation {
      bulkOperationRunMutation(
        mutation: "mutation customerUpdate($id: ID!, $tags: [String!]) { customerUpdate(input: {id: $id, tags: $tags}) { userErrors { field message } } }",
        stagedUploadPath: "updates.ndjson"
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

  const upload = fs.readFileSync('updates.ndjson', 'utf8');
  const res = await client.post('', { query: mutation, variables: {} });
  console.log('🚀 Submitted bulk mutation:', res.data);
}

uploadBulkMutation().catch(console.error);
