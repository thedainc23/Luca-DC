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

const COURSE_OBJECT_TYPE = '0-410'; // Replace with actual course object ID

// Util: Parse course ID from product title
function parseCourseIdFromTitle(title) {
  try {
    const baseTitle = title.split(' - ')[0].trim(); // Always take the first part before " - "
    return baseTitle; // e.g., "Miami, FL, USA- June 8th & 9th, 2025"
  } catch (err) {
    console.error("❌ Course ID parse error:", err);
    return null;
  }
}

// Check if SKU matches expected 'both-days'
function checkSkuForBothDays(sku) {
  return sku === 'both-days';
}

// Get the properties for the course object
async function getCourseObjectProperties() {
  const url = `https://api.hubapi.com/crm/v3/properties/${COURSE_OBJECT_TYPE}`;
  const response = await axios.get(url, {
    headers: hubheaders
  });

  return response.data.results;
}

// Get the association type for linking contacts to courses (attendees)
async function getAttendeeAssociationTypeId() {
  const url = `https://api.hubapi.com/crm/v4/associations/schema/${COURSE_OBJECT_TYPE}/contact`;
  const response = await axios.get(url, {
    headers: hubheaders
  });

  return response.data.results;
}

// Upsert course and associate customer (attendee)
async function upsertCourseAndAssociateCustomer(courseId, shopifyCustomer) {
  const email = shopifyCustomer.email;
  let contactId, companyId;

  // Find or create contact
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

  // Optionally find company by domain
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

  // Search or create course object
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

  // Associations
  const attendeeAssocId = await getAttendeeAssociationTypeId();

  if (attendeeAssocId) {
    await axios.put(
      `https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}/${courseObjectId}/associations/contact/${contactId}/${attendeeAssocId}`,
      {},
      { headers: hubheaders }
    );
  }

  // If a company exists, you can associate it here as well (optional)
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
      
      // Check if the SKU is 'both-days'
      if (checkSkuForBothDays(item.sku)) {
        const courseId = parseCourseIdFromTitle(rawTitle);
        if (!courseId) {
          console.error(`❌ Could not parse course ID from: ${rawTitle}`);
          continue;
        }

        console.log(`✅ Parsed course ID: ${courseId}`);
        
        // Proceed with upserting the course and associating the customer
        await upsertCourseAndAssociateCustomer(courseId, order.customer);

        const userRef = db.collection('hubspot-classes').doc(`DC-${orderId}`);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
          await userRef.set({
            customerId,
            orderId,
            tags: courseId
          });
        } else {
          await userRef.set({ tags: courseId }, { merge: true });
        }

        return res.status(200).send("✅ Order processed and synced with HubSpot.");
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
