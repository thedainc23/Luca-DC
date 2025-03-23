const express = require('express');
const db = require('../../../config/db'); // Firestore database connection
const router = express.Router();

// Function to update customer data, loyalty, and order history in one document
async function updateCustomerData(customerId, orderInfo, points) {
    try {
        const userRef = db.collection('customers').doc(`DC-${customerId}`);
        const userDoc = await userRef.get();

        let customerData = {
            loyalty: { points: 0, stamps: 0 },
            orderHistory: []
        };

        if (userDoc.exists) {
            customerData = userDoc.data() || {};
            customerData.loyalty = customerData.loyalty || { points: 0, stamps: 0 };
            customerData.orderHistory = customerData.orderHistory || [];
        }

        // Update loyalty points
        customerData.loyalty.points += points;

        // Calculate and add stamps (1 stamp for every 5 items)
        const totalItems = orderInfo.lineItems.reduce((acc, item) => acc + item.quantity, 0);
        const newStamps = Math.floor(totalItems / 5);
        customerData.loyalty.stamps += newStamps;

        // Add order to history (keeping only the last 10 orders for performance)
        customerData.orderHistory.unshift(orderInfo);
        if (customerData.orderHistory.length > 10) {
            customerData.orderHistory.pop();
        }

        // Update Firestore with merged data
        await userRef.set(customerData, { merge: true });

        console.log(`✅ Updated customer ${customerId} with order & loyalty info.`);
    } catch (error) {
        console.error('❌ Error updating customer data:', error);
    }
}

// Webhook to handle Shopify order payment notifications
router.post('/webhook/orders/paid', async (req, res) => {
    try {
        const order = req.body;

        if (!order || !order.customer) {
            console.error("❌ Invalid order or missing customer data.");
            return res.status(400).send("Invalid order data.");
        }

        const customerId = order.customer.id;
        const orderTotal = parseFloat(order.total_price) || 0;

        // Order Information
        const orderInfo = {
            orderId: order.id,
            totalPrice: orderTotal.toFixed(2),
            currency: order.currency || "USD",
            createdAt: order.created_at || null,
            lineItems: order.line_items
                ? order.line_items.map(item => ({
                    productId: item.variant_id || null,
                    productTitle: item.title || "Unknown Product",
                    quantity: item.quantity || 0,
                    price: parseFloat(item.price).toFixed(2) || "0.00"
                }))
                : []
        };

        // Loyalty points = total dollars spent (can be modified as needed)
        const loyaltyPoints = Math.floor(orderTotal);

        // Store all data under the customer document
        await updateCustomerData(customerId, orderInfo, loyaltyPoints);

        res.status(200).send("✅ Order payment processed successfully.");
    } catch (error) {
        console.error("❌ Error processing order webhook:", error);
        res.status(500).send("Internal server error.");
    }
});

module.exports = router;