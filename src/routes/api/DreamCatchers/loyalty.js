const express = require('express');
const db = require('../../../config/db'); // Firestore database connection
const router = express.Router();


const SHOPIFY_STORE = "www.dreamcatchers.com";
const SHOPIFY_ACCESS_TOKEN = "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";  // Your token

const axios = require('axios');  // Assuming you're using axios for HTTP requests

// Function to fetch product tags from Shopify using variantId
async function fetchProductTags(variantId) {
    const shopifyUrl = `https://${SHOPIFY_STORE_URL}/admin/api/2023-03/products/${variantId}/metafields.json`; // Example endpoint

    try {
        const response = await axios.get(shopifyUrl, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
            }
        });

        // Assuming the response includes product tags
        const productTags = response.data.metafields || [];
        return productTags;
    } catch (error) {
        console.error('Error fetching product tags from Shopify:', error);
        return [];
    }
}

// Function to store a new client if they don't exist
async function storeClient(customerDetails) {
    try {
        const { customerId, firstName, lastName, email, phone, totalSpent, ordersCount, acceptsMarketing, tags, defaultAddress, addresses, lastOrder } = customerDetails;

        const userRef = db.collection('customers').doc(`DC-${customerId}`);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            console.log(`Customer ${customerId} already exists.`);
            return; // No need to create again
        }

        // Check if loyalty data exists in separate collection
        const loyaltyRef = db.collection('loyalty').doc(`DC-${customerId}`);
        const loyaltyDoc = await loyaltyRef.get();
        const loyaltyData = loyaltyDoc.exists ? loyaltyDoc.data().loyalty : { points: 0, stamps: 0 };

        await userRef.set({
            customerId,
            firstName,
            lastName,
            email,
            phone,
            totalSpent: parseFloat(totalSpent) || 0,
            ordersCount: ordersCount || 0,
            acceptsMarketing: acceptsMarketing || false,
            tags: tags || [],
            defaultAddress: defaultAddress || {},
            addresses: addresses || [],
            lastOrder: lastOrder || {},
            loyalty: loyaltyData,
            createdAt: new Date(),
            orderHistory: []
        });

        console.log(`✅ Customer ${customerId} created successfully.`);
    } catch (error) {
        console.error('❌ Error storing customer data:', error);
    }
}

// Function to update or create customer data, loyalty, and order history
// Function to update or create customer data, loyalty, and order history in one document
async function updateCustomerData(customerId, customerDetails, orderInfo, points) {
    try {
        const userRef = db.collection('customers').doc(`DC-${customerId}`);
        const userDoc = await userRef.get();

        let customerData = {
            customerId: customerId,
            firstName: customerDetails.firstName || "Unknown",
            lastName: customerDetails.lastName || "Unknown",
            email: customerDetails.email || "",
            phone: customerDetails.phone || "",
            totalSpent: parseFloat(customerDetails.totalSpent) || 0,
            ordersCount: customerDetails.ordersCount || 0,
            acceptsMarketing: customerDetails.acceptsMarketing || false,
            tags: customerDetails.tags || [],
            defaultAddress: customerDetails.defaultAddress || {},
            addresses: customerDetails.addresses || [],
            lastOrder: orderInfo || {}, // Store last order details
            loyalty: {
                points: points || 0,
                stamps: 0
            },
            createdAt: new Date(),
            orderHistory: []
        };

        // Check line items for "hair_extensions" tag, and fetch if necessary
        const hairExtensionsItems = await Promise.all(orderInfo.lineItems.map(async (item) => {
            // If item.tags exist, check for the "hair_extensions" tag
            if (item.tags && item.tags.includes("hair_extensions")) {
                return item;
            }

            // If item.tags don't exist, fetch the product tags from Shopify
            const productTags = await fetchProductTags(item.variant_id);
            if (productTags.includes("hair_extensions")) {
                return item;
            }
            return null;
        }));

        // Filter out any null items (those without the "hair_extensions" tag)
        const hairExtensionsItemsFiltered = hairExtensionsItems.filter(item => item !== null);

        // Calculate the total quantity of "hair_extensions" items
        const totalHairExtensions = hairExtensionsItemsFiltered.reduce((acc, item) => acc + item.quantity, 0);

        // Add stamps based on the number of hair_extension items (1 stamp for every 5 items)
        const newStamps = Math.floor(totalHairExtensions / 5);
        customerData.loyalty.stamps += newStamps;

        // If the customer exists, update their data
        if (userDoc.exists) {
            customerData = userDoc.data() || {};
            customerData.loyalty = customerData.loyalty || { points: 0, stamps: 0 };
            customerData.orderHistory = customerData.orderHistory || [];
            customerData.totalSpent = customerData.totalSpent || 0;
            customerData.ordersCount = customerData.ordersCount || 0;

            // Update loyalty points
            customerData.loyalty.points += points;

            // Update total spent and orders count
            customerData.totalSpent += parseFloat(orderInfo.totalPrice);
            customerData.ordersCount += 1;

            // Update last order
            customerData.lastOrder = orderInfo;

            // Add order to history (keeping only the last 10 orders for performance)
            customerData.orderHistory.unshift(orderInfo);
            if (customerData.orderHistory.length > 10) {
                customerData.orderHistory.pop();
            }
        }

        // Ensure no undefined values are passed to Firestore
        customerData.orderHistory = customerData.orderHistory.filter(order => order.orderId !== undefined);

        // Save/update Firestore with merged data
        await userRef.set(customerData, { merge: true });

        console.log(`✅ Customer ${customerId} data updated successfully.`);
    } catch (error) {
        console.error('❌ Error updating customer data:', error);
    }
}

// Webhook to handle Shopify order payment notifications
router.post('/webhook/orders/paid', async (req, res) => {
    try {
        const order = req.body;

        // Log the entire order to debug missing fields
        console.log("Received Order Data:", JSON.stringify(order, null, 2));

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
            productId: item.variant_id || null,
            productTitle: item.title || "Unknown Product",
            quantity: item.quantity || 0,
            price: parseFloat(item.price).toFixed(2) || "0.00",
            tags: Array.isArray(item.tags) ? item.tags : [] // Ensure tags is an array
        }));

        const orderInfo = {
            orderId,
            totalPrice: orderTotal.toFixed(2),
            currency: order.currency || "USD",
            createdAt: order.created_at || null,
            updatedAt: order.updated_at || null,
            lineItems
        };

        // Prepare customer details for creation (if missing)
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

        // Calculate loyalty points
        const loyaltyPoints = Math.floor(orderTotal);

        // Update customer, create if missing
        await updateCustomerData(customerId, customerDetails, orderInfo, loyaltyPoints);

        res.status(200).send("✅ Order processed successfully.");
    } catch (error) {
        console.error("❌ Error processing order webhook:", error);
        res.status(500).send("Internal server error.");
    }
});

module.exports = router;