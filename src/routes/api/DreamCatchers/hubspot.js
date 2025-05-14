const express = require('express');
const axios = require('axios');
const db = require('../../../config/db');

const router = express.Router();

const SHOPIFY_STORE = "www.dreamcatchers.com";
const SHOPIFY_ACCESS_TOKEN = "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";
const HUBSPOT_TOKEN = 'pat-na1-ba55e700-bee3-4223-8a2c-580b4757fa23';

const HUB_HEADERS = {
  Authorization: `Bearer ${HUBSPOT_TOKEN}`,
  'Content-Type': 'application/json'
};

const COURSE_OBJECT_TYPE = '0-410';
const REQUIRED_PIPELINE_STAGE = '3e1a235d-1a64-4b7a-9ed5-7f0273ebd774';

async function getOrCreateContact(customer) {
  const email = customer.email;
  const searchBody = {
    filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
    properties: ['email']
  };

  const searchRes = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts/search', searchBody, { headers: HUB_HEADERS });
  if (searchRes.data.results.length > 0) return searchRes.data.results[0].id;

  const createRes = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts', {
    properties: {
      email,
      firstname: customer.first_name || '',
      lastname: customer.last_name || ''
    }
  }, { headers: HUB_HEADERS });

  return createRes.data.id;
}

async function getOrCreateCourse(courseId) {
  const searchBody = {
    filterGroups: [{
      filters: [{ propertyName: 'hs_course_id', operator: 'EQ', value: courseId }]
    }],
    properties: ['hs_course_id']
  };

  const searchRes = await axios.post(`https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}/search`, searchBody, { headers: HUB_HEADERS });
  if (searchRes.data.results.length > 0) return searchRes.data.results[0].id;

  const createRes = await axios.post(`https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}`, {
    properties: {
      hs_course_id: courseId,
      hs_course_name: courseId,
      hs_pipeline_stage: REQUIRED_PIPELINE_STAGE
    }
  }, { headers: HUB_HEADERS });

  return createRes.data.id;
}

async function getAssociationTypeId(from, to, labelContains) {
  const res = await axios.get(`https://api.hubapi.com/crm/v4/associations/schema/${from}/${to}`, { headers: HUB_HEADERS });
  const match = res.data.results.find(r => r.label?.toLowerCase().includes(labelContains.toLowerCase()));
  return match?.associationTypeId || null;
}

async function associateObjects(fromType, fromId, toType, toId, label) {
  const assocId = await getAssociationTypeId(fromType, toType, label);
  if (!assocId) throw new Error(`Association ID not found for ${fromType} → ${toType}`);
  const url = `https://api.hubapi.com/crm/v3/objects/${fromType}/${fromId}/associations/${toType}/${toId}/${assocId}`;
  await axios.put(url, {}, { headers: HUB_HEADERS });
}

router.post('/webhook/orders/paid', async (req, res) => {
  try {
    const order = req.body;
    const customer = order.customer;

    if (!order || !customer || !order.line_items) {
      return res.status(400).send("❌ Invalid order structure");
    }

    const relevantItem = order.line_items.find(item => item.sku?.includes("both-days"));
    if (!relevantItem) return res.status(200).send("No qualifying product found");

    // Derive Course ID from product title
    const parts = relevantItem.title.split(/[,\s-]+/);
    const courseId = `${parts[0]}-${parts[1]}-${parts[3]}-${parts[4].replace(/\D/g, '')}-${parts[6].replace(/\D/g, '')}-${parts[7]}`;

    const contactId = await getOrCreateContact(customer);
    const courseObjectId = await getOrCreateCourse(courseId);

    await associateObjects(COURSE_OBJECT_TYPE, courseObjectId, 'contact', contactId, 'contact');

    // Update Shopify order tags
    const shopifyUrl = `https://${SHOPIFY_STORE}/admin/api/2023-01/orders/${order.id}.json`;
    await axios.put(shopifyUrl, {
      order: { id: order.id, tags: courseId }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
      }
    });

    // Save to Firestore
    const ref = db.collection('hubspot-classes').doc(`DC-${order.id}`);
    await ref.set({ customerId: customer.id, orderId: order.id, tags: courseId }, { merge: true });

    res.status(200).send("✅ Course created and associated successfully.");
  } catch (err) {
    console.error("❌ Error:", {
      message: err?.response?.data?.message || err.message,
      details: err?.response?.data || err
    });
    res.status(500).send("Internal server error.");
  }
});

module.exports = router;
