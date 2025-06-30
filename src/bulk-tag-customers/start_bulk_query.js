const axios = require('axios');

const SHOP = 'sm-dream.myshopify.com';
const TOKEN = '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';

const client = axios.create({
  baseURL: `https://${SHOP}/admin/api/2024-01/graphql.json`,
  headers: {
    'X-Shopify-Access-Token': TOKEN,
    'Content-Type': 'application/json',
  },
});

async function startBulkQuery() {
  const query = `
    mutation {
      bulkOperationRunQuery(
        query: """
        {
          customers {
            nodes {
              id
              tags
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

  try {
    const response = await client.post('', { query });
    console.log('✅ Bulk Query Started:', JSON.stringify(response.data, null, 2));

    const errors = response.data.data.bulkOperationRunQuery.userErrors;
    if (errors && errors.length > 0) {
      console.error('User errors:', errors);
    } else {
      const operation = response.data.data.bulkOperationRunQuery.bulkOperation;
      console.log(`Bulk operation started with ID: ${operation.id}, status: ${operation.status}`);
    }
  } catch (error) {
    console.error('Error starting bulk query:', error);
  }
}

startBulkQuery();
