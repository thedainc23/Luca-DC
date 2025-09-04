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

async function upsertCourseAndAssociateCustomer(courseId, tagid, shopifyCustomer) {
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
        filters: [{ propertyName: 'hs_course_id', operator: 'EQ', value: tagid }]
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
          hs_course_id: tagid,
          hs_course_name: courseId,
          hs_pipeline_stage: '3e1a235d-1a64-4b7a-9ed5-7f0273ebd774',
          hs_enrollment_capacity: 40,
          course_date_and_time: new Date().toISOString(),
          last_day_to_sign_up: new Date('2028-06-01').toISOString()
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

    // Loop through line items
    for (const item of order.line_items) {
      const productSku = item.sku;
      if (productSku.includes(EXPECTED_SKU)) {
        // --- FIXED PARSING LOGIC ---
// Split by "-" but only take the first 2 meaningful parts
const titleParts = item.title.split('-').map(s => s.trim());

// cityState = first chunk ("Dallas, TX, USA")
// datePart  = second chunk ("Sept 7th & 8th, 2025")
const cityState = titleParts[0];
const datePart = titleParts[1];

// Extract location (City + State, drop USA if present)
const cityStateParts = cityState.split(',').map(s => s.trim());
const city = cityStateParts[0].replace(/\s+/g, '-'); // handles multi-word
const state = cityStateParts[1];
const location = `${city}-${state}`;

// Extract date info
const dateTokens = datePart.split(/\s+/);
const month = dateTokens[0];
const dayRange = `${dateTokens[1].replace(/\D/g, '')}-${dateTokens[3].replace(/\D/g, '')}`;
const year = dateTokens[4].replace(/\D/g, '');

const newTag = `${location}-${month}-${dayRange}-${year}`;
// --- END FIX ---


        // Get existing order tags
        const shopifyGetUrl = `https://${SHOPIFY_STORE}/admin/api/2023-01/orders/${orderId}.json`;
        const getResp = await axios.get(shopifyGetUrl, {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
          }
        });

        // Append if new tag is not already there
        const existingTags = getResp.data.order.tags
          ? getResp.data.order.tags.split(',').map(tag => tag.trim())
          : [];

        if (!existingTags.includes(newTag)) {
          existingTags.push(newTag);
        }

        const updatedTags = existingTags.join(', ');

        // Update order tags in Shopify
        const body = JSON.stringify({
          order: {
            id: orderId,
            tags: updatedTags
          }
        });

        const response = await axios.put(shopifyGetUrl, body, {
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
          }
        });

        if (response.status >= 200 && response.status < 300) {
          console.log('Order tags updated successfully:', response.data);
        } else {
          console.error('Error updating order tags:', response.data);
        }

        // Sync data to Firestore
        const userRef = db.collection('hubspot-classes').doc(`DC-${orderId}`);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
          await userRef.set({
            customerId,
            orderId,
            tags: updatedTags || "",
          });
        } else {
          await userRef.set({ tags: updatedTags }, { merge: true });
        }

        // Sync with HubSpot: Use the new tag as courseId
        const courseId = parseCourseIdFromTitle(item.title);
        const confirmedCourseId = newTag; // Use the newTag instead of item.title
        await upsertCourseAndAssociateCustomer(courseId, confirmedCourseId, order.customer);

        return res.status(200).send("✅ Order processed successfully to Hubspot.");
      }
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
