const express = require('express');
const db = require('../../../config/db'); // Firestore database connection
const router = express.Router();
const axios = require('axios');

const SHOPIFY_STORE = "www.dreamcatchers.com";
const SHOPIFY_ACCESS_TOKEN = "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";

const HUBSPOT_TOKEN = 'pat-na1-e5f8e2e6-07e7-47aa-b1be-fda63286ed7b';
const hubheaders = {
  Authorization: `Bearer ${HUBSPOT_TOKEN}`,
  'Content-Type': 'application/json'
};

const COURSE_OBJECT_TYPE = '0-410'; // Your HubSpot custom object type ID

async function upsertCourseAndAssociateCustomer(courseId, shopifyCustomer, courseData) {
  const contactSearchUrl = 'https://api.hubapi.com/crm/v3/objects/contacts/search';
  const email = shopifyCustomer.email;
  let contactId;

  // 1. Search or create contact
  const searchBody = {
    filterGroups: [{
      filters: [{
        propertyName: 'email',
        operator: 'EQ',
        value: email
      }]
    }],
    properties: ['email']
  };

  const contactSearchResp = await axios.post(contactSearchUrl, searchBody, { headers: hubheaders });
  if (contactSearchResp.data.results.length > 0) {
    contactId = contactSearchResp.data.results[0].id;
  } else {
    const contactCreateResp = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/contacts',
      {
        properties: {
          email,
          firstname: shopifyCustomer.first_name || '',
          lastname: shopifyCustomer.last_name || ''
        }
      },
      { headers: hubheaders }
    );
    contactId = contactCreateResp.data.id;
  }

  // 2. Search or create course object
  const searchUrl = `https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}/search`;
  const courseSearchBody = {
    filterGroups: [{
      filters: [{
        propertyName: 'course_id',
        operator: 'EQ',
        value: courseId
      }]
    }],
    properties: ['course_id']
  };

  const searchResp = await axios.post(searchUrl, courseSearchBody, { headers: hubheaders });
  let courseObjectId;

  if (searchResp.data.results.length > 0) {
    courseObjectId = searchResp.data.results[0].id;
  } else {
    const createUrl = `https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}`;
    const createResp = await axios.post(createUrl, {
      properties: {
        course_id: courseId,
        name: courseId // Example property, adjust as needed
      }
    }, { headers: hubheaders });
    courseObjectId = createResp.data.id;
  }

  // 3. Associate contact to course
  const associateUrl = `https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}/${courseObjectId}/associations/company/${companyId}/courses_to_companies`;
  await axios.put(associateUrl, {}, { headers: hubheaders });
}

router.post('/webhook/orders/paid', async (req, res) => {
  try {
    const order = req.body;
    let tags = order.tags || "";

    if (!order || !order.customer || !order.customer.id || !order.id || !order.total_price || !order.line_items) {
      console.error("❌ Invalid order or missing customer data");
      return res.status(400).send("Invalid order data.");
    }

    const customerId = order.customer.id;
    const orderId = order.id;
    const url = `https://${SHOPIFY_STORE}/admin/api/2023-01/orders/${orderId}.json`;

    const lineItems = order.line_items.map(item => ({
      productId: item.product_id || null,
      variantID: item.variant_id || null,
      productTitle: item.title || "Unknown Product",
      productName: item.name || "Unknown Product",
      tags: Array.isArray(item.tags) ? item.tags : [],
      sku: item.sku || null,
      discountCodes: order.discount_applications || [],
    }));

    for (const item of lineItems) {
      const productSku = item.sku;
      if (productSku.includes("both-days")) {
        const parts = item.productTitle.split(/[,\s-]+/);
        const location = parts.slice(0, 2).join('-');
        const month = parts[3];
        const dayRange = parts[4].replace(/\D/g, '') + "-" + parts[6].replace(/\D/g, '');
        const year = parts[7];
        const newTag = ` ${location}-${month}-${dayRange}-${year}`;
        tags = newTag;

        const updatedTags = tags;
        const body = JSON.stringify({
          order: {
            id: orderId,
            tags: updatedTags
          }
        });

        const response = await axios.put(url, body, {
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
          }
        });

        if (response.status >= 200 && response.status < 300) {
          console.log('✅ Order tags updated successfully');
        } else {
          console.error('❌ Error updating order tags:', response.data);
        }

        await upsertCourseAndAssociateCustomer(newTag.trim(), order.customer, order.customer);

        const userRef = db.collection('hubspot-classes').doc(`DC-${orderId}`);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
          await userRef.set({
            customerId,
            orderId,
            tags: updatedTags || ""
          });
        } else {
          await userRef.set({ tags: updatedTags }, { merge: true });
        }

        return res.status(200).send("✅ Order processed successfully to HubSpot.");
      }
    }

    res.status(200).send("No qualifying product found.");
  } catch (error) {
    console.error("❌ Error processing order webhook:", error?.response?.data || error.message);
    res.status(500).send("Internal server error.");
  }
});

module.exports = router;
