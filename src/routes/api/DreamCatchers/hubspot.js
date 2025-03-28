const express = require('express');
const db = require('../../../config/db'); // Firestore database connection
const router = express.Router();
const axios = require('axios');  // Assuming you're using axios for HTTP requests
const SHOPIFY_STORE = "www.dreamcatchers.com";
const SHOPIFY_ACCESS_TOKEN = "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";  // Your token


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