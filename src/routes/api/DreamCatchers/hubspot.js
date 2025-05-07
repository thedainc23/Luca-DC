const express = require('express');
const db = require('../../../config/db'); // Firestore database connection
const router = express.Router();
const axios = require('axios');

const SHOPIFY_STORE = "www.dreamcatchers.com";
const SHOPIFY_ACCESS_TOKEN = "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";

const HUBSPOT_TOKENN = 'pat-na1-e5f8e2e6-07e7-47aa-b1be-fda63286ed7b';
const HUBSPOT_TOKEN = 'pat-na1-ba55e700-bee3-4223-8a2c-580b4757fa23'
const hubheaders = {
  Authorization: `Bearer ${HUBSPOT_TOKEN}`,
  'Content-Type': 'application/json'
};

const COURSE_OBJECT_TYPE = '0-410'; // Your HubSpot custom object type ID

async function getAssociationTypeId(fromType, toType, labelContains) {
    const url = `https://api.hubapi.com/crm/v4/associations/schema/${fromType}/${toType}`;
    const resp = await axios.get(url, { headers: hubheaders });
  
    const match = resp.data.results.find(a =>
      a.label && a.label.toLowerCase().includes(labelContains.toLowerCase())
    );
  
    return match ? match.associationTypeId : null;
  }
  
  async function upsertCourseAndAssociateCustomer(courseId, shopifyCustomer, courseData) {
    const contactSearchUrl = 'https://api.hubapi.com/crm/v3/objects/contacts/search';
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
  
    const searchUrl = `https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}/search`;
    const courseSearchBody = {
        filterGroups: [{
          filters: [{
            propertyName: 'class_id', // changed from course_id
            operator: 'EQ',
            value: courseId
          }]
        }],
        properties: ['class_id'] // changed from course_id
      };
  
    const searchResp = await axios.post(searchUrl, courseSearchBody, { headers: hubheaders });
    let courseObjectId;
  
    if (searchResp.data.results.length > 0) {
      courseObjectId = searchResp.data.results[0].id;
    } else {
        console.log("🔍 Searching HubSpot for class_id:", courseId);
      const createUrl = `https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}`;
      console.log("🔍 Search results:", JSON.stringify(searchResp.data.results, null, 2));


      const createResp = await axios.post(createUrl, {
        properties: {
          class_id: courseId, // changed from course_id
          hs_course_name: courseId
        }
      }, { headers: hubheaders });
      courseObjectId = createResp.data.id;
    }
  
    // Fetch proper association type IDs
    const contactAssocId = await getAssociationTypeId(COURSE_OBJECT_TYPE, 'contact', 'contact');
    const companyAssocId = await getAssociationTypeId(COURSE_OBJECT_TYPE, 'company', 'company');
  
    if (!contactAssocId) {
      throw new Error('❌ Could not find association type ID for Course → Contact');
    }
  
    // Associate contact
    const contactAssociateUrl = `https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}/${courseObjectId}/associations/contact/${contactId}/${contactAssocId}`;
    await axios.put(contactAssociateUrl, {}, { headers: hubheaders });
  
    // Associate company if available
    if (companyId && companyAssocId) {
      const companyAssociateUrl = `https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}/${courseObjectId}/associations/company/${companyId}/${companyAssocId}`;
      try {
        const associateResp = await axios.put(companyAssociateUrl, {}, { headers: hubheaders });
        console.log("✅ Associated course with company:", associateResp.data);
      } catch (err) {
        console.error("❌ Failed to associate company:", {
          message: err?.response?.data?.message,
          status: err?.response?.status,
          data: err?.response?.data
        });
      }
    }
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
        console.error("❌ Error creating HubSpot object:", {
            message: error?.response?.data?.message,
            requiredProperties: error?.response?.data?.context?.properties,
            status: error?.response?.status,
            data: error?.response?.data
        });
  
      res.status(500).send("Internal server error.");
    }
  });
  
  module.exports = router;
