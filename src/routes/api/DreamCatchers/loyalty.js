const express = require('express');
const db = require('../../../config/db'); // Firestore database connection
const router = express.Router();

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
async function updateCustomerData(customerId, customerDetails, orderInfo, points) {
    try {
        const userRef = db.collection('customers').doc(`DC-${customerId}`);
        const userDoc = await userRef.get();

        let customerData;

        if (!userDoc.exists) {
            console.log(`🚀 Customer ${customerId} does not exist. Creating now...`);
            await storeClient(customerDetails); // Create customer if missing
            customerData = customerDetails; // Use initial data
        } else {
            customerData = userDoc.data() || {};
        }

        // Ensure default values exist
        customerData.loyalty = customerData.loyalty || { points: 0, stamps: 0 };
        customerData.orderHistory = customerData.orderHistory || [];
        customerData.totalSpent = customerData.totalSpent || 0;
        customerData.ordersCount = customerData.ordersCount || 0;

        // Update loyalty points
        customerData.loyalty.points += points;

        // Calculate and add stamps (1 stamp for every 5 items)
        const totalItems = orderInfo.lineItems.reduce((acc, item) => acc + item.quantity, 0);
        const newStamps = Math.floor(totalItems / 5);
        customerData.loyalty.stamps += newStamps;

        // Update total spent and orders count
        customerData.totalSpent += parseFloat(orderInfo.totalPrice);
        customerData.ordersCount += 1;

        // Update last order
        customerData.lastOrder = orderInfo;

        // Add order to history (keeping only the last 10 orders)
        customerData.orderHistory.unshift(orderInfo);
        if (customerData.orderHistory.length > 10) {
            customerData.orderHistory.pop();
        }

        // Save/update Firestore with merged data
        await userRef.set(customerData, { merge: true });

        console.log(`✅ Customer ${customerId} updated successfully.`);
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