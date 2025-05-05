const express = require('express');
const db = require('../../../config/db'); // Firestore database connection
const router = express.Router();
const axios = require('axios');  // Assuming you're using axios for HTTP requests
const SHOPIFY_STORE = "www.dreamcatchers.com";
const SHOPIFY_ACCESS_TOKEN = "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";  // Your token

const HUBSPOT_TOKEN = 'pat-na1-e5f8e2e6-07e7-47aa-b1be-fda63286ed7b'; // Use a Private App token
const hubheaders = {
    Authorization: `Bearer ${HUBSPOT_TOKEN}`,
    'Content-Type': 'application/json'
  };

const COURSE_OBJECT_TYPE = 'courses'; // or your actual objectTypeId




async function upsertCourseAndAssociateCustomer(courseId, customerId, courseData) {
    // 1. Search for course
    const searchUrl = `https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}/search`;
    const searchBody = {
      filterGroups: [{
        filters: [{
          propertyName: 'course_id', // Use the correct property name here
          operator: 'EQ',
          value: courseId
        }]
      }],
      properties: ['course_id']
    };
  
    const searchResp = await axios.post(searchUrl, searchBody, { headers: hubheaders });
    let courseObjectId;
  
    if (searchResp.data.results.length > 0) {
      courseObjectId = searchResp.data.results[0].id;
    } else {
      // 2. Create course if not found
      const createUrl = `https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}`;
      const createResp = await axios.post(createUrl, {
        properties: {
          ...courseData,
          course_id: courseId
        }
      }, { headers });
      courseObjectId = createResp.data.id;
    }
  
    // 3. Associate customer (contact) to course
    const associateUrl = `https://api.hubapi.com/crm/v3/objects/${COURSE_OBJECT_TYPE}/${courseObjectId}/associations/contact/${customerId}/course_to_contact`; // replace association label if needed
    await axios.put(associateUrl, {}, { headers: hubheaders });
  }






router.post('/webhook/orders/paid', async (req, res) => {
    try {
        const order = req.body;
        let tags = order.tags || "";

        // console.log("🚀 Received order webhook:", order);

        // Validate required fields
        if (!order || !order.customer || !order.customer.id || !order.id || !order.total_price || !order.line_items) {
            console.error("❌ Invalid order or missing customer data:", {
                customer: order.customer,
                orderId: order.id,
                totalPrice: order.total_price,
                lineItems: order.line_items
            });
            return res.status(400).send("Invalid order data.");
        }

        const customerId = order.customer.id;
        const orderId = order.id;
        const lineItems = order.line_items.map(item => ({
            productId: item.product_id || null,
            varientID: item.variant_id || null,
            productTitle: item.title || "Unknown Product",
            productName: item.name || "Unknown Product",
            tags: Array.isArray(item.tags) ? item.tags : [], // Ensure tags is an array
            sku: item.sku || null,
            discountCodes: order.discount_applications || [],
        }));
        
        const url = `https://${SHOPIFY_STORE}/admin/api/2023-01/orders/${orderId}.json`;

        for (const item of lineItems) {
            const productSku = item.sku;
            if(productSku.includes("both-days")){
                const parts = item.productTitle.split(/[,\s-]+/);
                // Step 2: Extract the location and event date parts
                const location = parts.slice(0, 2).join('-'); // "Dallas-TX"
                const month = parts[3]; // "May"
                const dayRange = parts[4].replace(/\D/g, '') + "-" + parts[6].replace(/\D/g, ''); // "4-5" (removes 'th' or 'st' from the date)
                const year = parts[7]; // "2025"

                console.log("🚀 parts:", parts);
                // Step 3: Combine all into the desired format
                let newTag = ` ${location}-${month}-${dayRange}-${year}`;
                console.log("🚀 newTag:", newTag);
                tags = newTag

                const updatedTags = tags
                // Prepare the payload to update the tags
                const body = JSON.stringify({
                    order: {
                    id: orderId,
                    tags: updatedTags  // Add your new tag here
                    }
                });


                const response = await axios.put(url, body, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN  // Access token for authentication
                    }
                });

                const data = response.data;

                if (response.ok) {
                    console.log('Order tags updated successfully:', data);
                } else {
                    console.error('Error updating order tags:', data);
                }
                upsertCourseAndAssociateCustomer(newTag, order.customer.id, order.customer);
                const userRef = db.collection('hubspot-classes').doc(`DC-${orderId}`);
                const userDoc = await userRef.get();
                if (!userDoc.exists) {
                    // If the customer does not exist, store the customer
                    await userRef.set({
                        customerId,
                        orderId,
                        tags: updatedTags || "",
                    });
                }
                else{
                    await userRef.set({tags: updatedTags}, { merge: true });
                }
                res.status(200).send("✅ Order processed successfully to Hubspot.");
            }
        }
    } catch (error) {
        console.error("❌ Error processing order webhook:", error);
        res.status(500).send("Internal server error.");
    }
});

module.exports = router;