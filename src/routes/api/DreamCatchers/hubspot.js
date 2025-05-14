const express = require('express');
const db = require('../../../config/db');
const router = express.Router();
const axios = require('axios');

const SHOPIFY_STORE = "www.dreamcatchers.com";
const SHOPIFY_ACCESS_TOKEN = "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";

const HUBSPOT_TOKEN = 'pat-na1-ba55e700-bee3-4223-8a2c-580b4757fa23';
const hubheaders = {
  Authorization: `Bearer ${HUBSPOT_TOKEN}`,
  'Content-Type': 'application/json'
};

const COURSE_OBJECT_TYPE = '0-410'; // Replace with actual ID if incorrect

function parseCourseIdFromTitle(title) {
  const match = title.match(/^(.*?)-\s*(\w+\s\d+(?:th)?(?:\s*&\s*\w+\s\d+(?:th)?)?)\s*(\d{4})/i);
  if (!match) return null;

  const city = match[1].trim().replace(/,/g, '').replace(/\s+/g, '-');
  const dateStr = match[2].replace(/\s+/g, '').replace('&', 'and');
  const year = match[3];

  return `${city}-${dateStr}-${year}`;
}

async function getAssociationTypeId(fromType, toType, labelContains) {
  const url = `https://api.hubapi.com/crm/v4/associations/schema/${fromType}/${toType}`;
  const resp = await axios.get(url, { headers: hubheaders });

  const match = resp.data.results.find(a =>
    a.label && a.label.toLowerCase().includes(labelContains.toLowerCase())
  );

  return match ? match.associationTypeId : null;
}

async function upsertCourseAndAssociateCustomer(courseId, shopifyCustomer) {
  let contactId, companyId;

  const contactSearchUrl = 'https://api.hubapi.com/crm/v3/objects/contacts/search';
  const email = shopifyCustomer.email;

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

  const domain = email?.split('@')[1];
  if (domain) {
    const companySearchResp = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/companies/search',
      {
        filterGroups: [{
          filters: [{
            propertyName: 'domain',
            operator: 'EQ',
            value: domain
          }]
        }],
        properties: ['name', 'domain']
      },
      { headers: hubheaders }
    );
    if (companySearchResp.data.results.length > 0) {
      companyId = companySearchResp.data.results[0].id;
    }
  }

  const courseSearchUrl = `https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}/search`;
  const courseSearchBody = {
    filterGroups: [{
      filters: [{
        propertyName: 'hs_course_id',
        operator: 'EQ',
        value: courseId
      }]
    }],
    properties: ['hs_course_id']
  };

  const searchResp = await axios.post(courseSearchUrl, courseSearchBody, { headers: hubheaders });
  let courseObjectId;

  if (searchResp.data.results.length > 0) {
    courseObjectId = searchResp.data.results[0].id;
  } else {
    const createUrl = `https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}`;
    const createResp = await axios.post(createUrl, {
      properties: {
        hs_course_id: courseId,
        hs_course_name: courseId,
        hs_pipeline_stage: '3e1a235d-1a64-4b7a-9ed5-7f0273ebd774',
        hs_enrollment_capacity: 0,
        course_date_and_time: new Date().toISOString(),
        last_day_to_sign_up: new Date('2025-06-01').toISOString()
      }
    }, { headers: hubheaders });

    courseObjectId = createResp.data.id;
  }

  const contactAssocId = await getAssociationTypeId(COURSE_OBJECT_TYPE, 'contact', 'contact');
  const companyAssocId = await getAssociationTypeId(COURSE_OBJECT_TYPE, 'company', 'company');

  if (!contactAssocId) throw new Error('Missing Course → Contact association type ID');

  const contactAssociateUrl = `https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}/${courseObjectId}/associations/contact/${contactId}/${contactAssocId}`;
  console.log("🔗 Associating contact:", contactAssociateUrl);
  await axios.put(contactAssociateUrl, {}, { headers: hubheaders });

  if (companyId && companyAssocId) {
    const companyAssociateUrl = `https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}/${courseObjectId}/associations/company/${companyId}/${companyAssocId}`;
    console.log("🔗 Associating company:", companyAssociateUrl);
    await axios.put(companyAssociateUrl, {}, { headers: hubheaders });
  }
}

router.post('/webhook/orders/paid', async (req, res) => {
  try {
    const order = req.body;

    if (!order || !order.customer || !order.line_items || !order.id) {
      console.error("❌ Missing essential order data.");
      return res.status(400).send("Invalid order data.");
    }

    const orderId = order.id;
    const orderTags = order.tags || "";
    const customer = order.customer;

    for (const item of order.line_items) {
      if (item.sku?.includes("both-days")) {
        const courseId = parseCourseIdFromTitle(item.title);

        if (!courseId) {
          console.error("❌ Could not parse course ID from:", item.title);
          return res.status(400).send("Course ID parse error.");
        }

        const newTag = ` ${courseId}`;
        const updateUrl = `https://${SHOPIFY_STORE}/admin/api/2023-01/orders/${orderId}.json`;

        await axios.put(updateUrl, {
          order: { id: orderId, tags: newTag }
        }, {
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
          }
        });

        await upsertCourseAndAssociateCustomer(courseId, customer);

        const orderRef = db.collection('hubspot-classes').doc(`DC-${orderId}`);
        const orderDoc = await orderRef.get();
        if (!orderDoc.exists) {
          await orderRef.set({ orderId, customerId: customer.id, tags: newTag });
        } else {
          await orderRef.set({ tags: newTag }, { merge: true });
        }

        return res.status(200).send("✅ Order processed.");
      }
    }

    res.status(200).send("No matching products.");
  } catch (error) {
    console.error("❌ HubSpot Integration Error:", {
      message: error?.response?.data?.message,
      context: error?.response?.data?.context,
      status: error?.response?.status,
      url: error?.config?.url
    });
    res.status(500).send("Server error.");
  }
});

module.exports = router;
