const express = require('express');
const db = require('../../../config/db'); // Firestore connection
const router = express.Router();
const axios = require('axios');

const SHOPIFY_STORE = "www.dreamcatchers.com";
const SHOPIFY_ACCESS_TOKEN = "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";
const HUBSPOT_TOKEN = 'pat-na1-ba55e700-bee3-4223-8a2c-580b4757fa23';

const hubheaders = {
  Authorization: `Bearer ${HUBSPOT_TOKEN}`,
  'Content-Type': 'application/json'
};

const COURSE_OBJECT_TYPE = '0-410';
const EXPECTED_SKU = 'both-days';

function parseCourseIdFromTitle(title) {
  try {
    const baseTitle = title.trim();
    return baseTitle;
  } catch (err) {
    console.error("❌ Course ID parse error:", err);
    return null;
  }
}

async function getAttendeeAssociationTypeId() {
  const url = `https://api.hubapi.com/crm/v4/associations/schema/${COURSE_OBJECT_TYPE}/contact`;
  const response = await axios.get(url, { headers: hubheaders });
  const assoc = response.data.results.find(r => r.name.toLowerCase().includes("attendee"));
  return assoc?.id;
}

async function getAssociationTypeId(fromType, toType, nameContains) {
  const url = `https://api.hubapi.com/crm/v4/associations/schema/${fromType}/${toType}`;
  const response = await axios.get(url, { headers: hubheaders });
  const assoc = response.data.results.find(r => r.name.toLowerCase().includes(nameContains));
  return assoc?.id;
}

async function upsertCourseAndAssociateCustomer(courseId, shopifyCustomer) {
  const email = shopifyCustomer.email;
  let contactId, companyId;

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

  const contactSearchResp = await axios.post(
    'https://api.hubapi.com/crm/v3/objects/contacts/search',
    searchBody,
    { headers: hubheaders }
  );

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

  const courseSearchResp = await axios.post(
    `https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}/search`,
    {
      filterGroups: [{
        filters: [{ propertyName: 'hs_course_id', operator: 'EQ', value: courseId }]
      }],
      properties: ['hs_course_id']
    },
    { headers: hubheaders }
  );

  let courseObjectId;
  if (courseSearchResp.data.results.length > 0) {
    courseObjectId = courseSearchResp.data.results[0].id;
  } else {
    const courseCreateResp = await axios.post(
      `https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}`,
      {
        properties: {
          hs_course_id: courseId,
          hs_course_name: courseId,
          hs_pipeline_stage: '3e1a235d-1a64-4b7a-9ed5-7f0273ebd774',
          hs_enrollment_capacity: 0,
          course_date_and_time: new Date().toISOString(),
          last_day_to_sign_up: new Date('2025-06-01').toISOString()
        }
      },
      { headers: hubheaders }
    );
    courseObjectId = courseCreateResp.data.id;
  }

  const attendeeAssocId = await getAttendeeAssociationTypeId();
  if (attendeeAssocId) {
    await axios.put(
      `https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}/${courseObjectId}/associations/contact/${contactId}/${attendeeAssocId}`,
      {},
      { headers: hubheaders }
    );
  }

  if (companyId) {
    const companyAssocId = await getAssociationTypeId(COURSE_OBJECT_TYPE, 'company', 'company');
    if (companyAssocId) {
      await axios.put(
        `https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}/${courseObjectId}/associations/company/${companyId}/${companyAssocId}`,
        {},
        { headers: hubheaders }
      );
    }
  }

  return courseId; // Return for tagging
}

router.post('/webhook/orders/paid', async (req, res) => {
  try {
    const order = req.body;

    if (!order?.customer?.id || !order.id || !order.line_items?.length) {
      return res.status(400).send("❌ Invalid order payload.");
    }

    const customerId = order.customer.id;
    const orderId = order.id;

    for (const item of order.line_items) {
      const rawTitle = item.title;
      console.log(`Checking raw product title: '${rawTitle}' | Quantity: ${item.quantity}`);

      if (item.sku !== EXPECTED_SKU) {
        console.log("⏭️ Skipping item due to unmatched SKU:", item.sku);
        continue;
      }

      const courseId = parseCourseIdFromTitle(rawTitle);
      if (!courseId) {
        console.error(`❌ Could not parse course ID from: ${rawTitle}`);
        continue;
      }

      console.log(`✅ Parsed course ID: ${courseId}`);

      const confirmedCourseId = await upsertCourseAndAssociateCustomer(courseId, order.customer);

      // 🏷️ Tag the Shopify order
      const shopifyTagUrl = `https://${SHOPIFY_STORE}/admin/api/2023-01/orders/${orderId}.json`;
      const tagBody = JSON.stringify({
        order: {
          id: orderId,
          tags: confirmedCourseId
        }
      });

      try {
        const tagResponse = await axios.put(shopifyTagUrl, tagBody, {
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
          }
        });

        if (tagResponse.status >= 200 && tagResponse.status < 300) {
          console.log(`🏷️ Order ${orderId} tagged with: ${confirmedCourseId}`);
        } else {
          console.error('❌ Error updating order tags:', tagResponse.data);
        }
      } catch (tagErr) {
        console.error('❌ Exception updating Shopify tags:', tagErr.response?.data || tagErr.message);
      }

      const userRef = db.collection('hubspot-classes').doc(`DC-${orderId}`);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        await userRef.set({
          customerId,
          orderId,
          tags: confirmedCourseId
        });
      } else {
        await userRef.set({ tags: confirmedCourseId }, { merge: true });
      }

      return res.status(200).send("✅ Order processed and synced with HubSpot.");
    }

    res.status(200).send("No qualifying products found.");
  } catch (err) {
    console.error("❌ Error in order webhook:", {
      message: err?.response?.data?.message,
      context: err?.response?.data?.context,
      status: err?.response?.status,
      data: err?.response?.data
    });
    res.status(500).send("Internal server error.");
  }
});

module.exports = router;
