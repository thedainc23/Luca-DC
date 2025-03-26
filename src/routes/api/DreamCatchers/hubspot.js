const express = require('express');
const db = require('../../../config/db'); // Firestore database connection
const router = express.Router();
const axios = require('axios');  // Assuming you're using axios for HTTP requests
const SHOPIFY_STORE = "www.dreamcatchers.com";
const SHOPIFY_ACCESS_TOKEN = "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";  // Your token


router.post('/webhook/orders/paid', async (req, res) => {
    try {
        const order = req.body;
        const tags = order.tags || [];
        let newTags = [...tags];

        console.log("🚀 Received order webhook:", order);

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
        const orderTotal = parseFloat(order.total_price) || 0;
        const lineItems = order.line_items.map(item => ({
            productId: item.product_id || null,
            varientID: item.variant_id || null,
            productTitle: item.title || "Unknown Product",
            productName: item.name || "Unknown Product",
            quantity: item.quantity || 0,
            price: parseFloat(item.price).toFixed(2) || "0.00",
            tags: Array.isArray(item.tags) ? item.tags : [], // Ensure tags is an array
            sku: item.sku || null,
            discountCodes: order.discount_applications || [],
        }));

        const orderInfo = {
            orderId,
            totalPrice: orderTotal.toFixed(2),
            currency: order.currency || "USD",
            createdAt: order.created_at || null,
            updatedAt: order.updated_at || null,
            lineItems
        };

        const customerDetails = {
            customerId: customerId,
            firstName: order.customer.first_name || "Unknown",
            lastName: order.customer.last_name || "Unknown",
            email: order.customer.email || "",
            phone: order.customer.phone || "",
            totalSpent: parseFloat(order.customer.total_spent) || 0,
            ordersCount: order.customer.orders_count || 0,
            acceptsMarketing: order.customer.accepts_marketing || false,
            tags: order.customer.tags || [],
            defaultAddress: order.customer.default_address || {},
            addresses: order.customer.addresses || [],
            lastOrder: orderInfo
        };
        const url = `https://${SHOPIFY_STORE}/admin/api/2023-01/orders/${orderId}.json`;

        for (const item of orderInfo.lineItems) {
            const productSku = item.sku;
            if(productSku == "both-days"){
                const parts = item.productTitle.split(/[,\s-]+/);
                // Step 2: Extract the location and event date parts
                const location = parts.slice(0, 2).join('-'); // "Dallas-TX"
                const month = parts[3]; // "May"
                const dayRange = parts[4] + "-" + parts[5].replace(/\D/g, ''); // "4-5" (removes 'th' or 'st' from the date)
                const year = parts[6]; // "2025"

                // Step 3: Combine all into the desired format
                const newTag = `${location}-${month}-${dayRange}-${year}`;
                newTags.push(newTag);
            }
        }

        // Prepare the payload to update the tags
        const body = JSON.stringify({
            order: {
            id: orderId,
            tags: newTags  // Add your new tag here
            }
        });

        const response = await axios.put(url, body, {
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN  // Access token for authentication
            }
        });

        const data = await response.json();

        if (response.ok) {
            console.log('Order tags updated successfully:', data);
        } else {
            console.error('Error updating order tags:', data);
        }

        // If the customer doesn't exist, create the customer first
        const userRef = db.collection('hubspot-classes').doc(`DC-${orderId}`);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            // If the customer does not exist, store the customer
            await userRef.set({
                customerId,
                orderId,
                customerDetails,
                orderInfo,
                tags: newTags || [],
            });
        }
        else{
            await userRef.set({tags: newTags}, { merge: true });
        }


        res.status(200).send("✅ Order processed successfully to Hubspot.");
    } catch (error) {
        console.error("❌ Error processing order webhook:", error);
        res.status(500).send("Internal server error.");
    }
});

module.exports = router;