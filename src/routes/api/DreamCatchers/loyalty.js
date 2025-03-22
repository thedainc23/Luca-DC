const express = require('express');
const db = require('../../../config/db'); // Firestore or database connection
const router = express.Router();

// Function to update loyalty points and stamps
async function updateLoyaltyPoints(customerId, points, lineItems) {
    try {
        const userRef = db.collection('loyalty').doc(`DC-${customerId.toString()}`);
        const userDoc = await userRef.get();

        let loyaltyData = { points: 0, stamps: 0 };

        if (userDoc.exists) {
            loyaltyData = userDoc.data().loyalty || { points: 0, stamps: 0 };
        }

        // Add points
        loyaltyData.points += points;

        // Count total items in the order
        const totalItems = lineItems.reduce((acc, item) => acc + item.quantity, 0);

        const newStamps = Math.floor(totalItems / 5);
        loyaltyData.stamps += newStamps;

        // Update Firestore
        await userRef.set({ loyalty: loyaltyData }, { merge: true });

        console.log(`Updated loyalty for customer ${customerId}:`, loyaltyData);
    } catch (error) {
        console.error('Error updating loyalty points:', error);
    }
}

// Function to store order and customer information
async function storeOrderAndCustomer(orderInfo, customerInfo) {
    try {
        if (!customerInfo.customerId || !orderInfo.orderId) {
            console.error('Missing customerId or orderId:', { customerInfo, orderInfo });
            return;
        }

        const orderRef = db.collection('loyalty').doc(`DC-${customerInfo.customerId.toString()}`);
        await orderRef.set(
            {
                orderId: orderInfo.orderId,
                customerId: customerInfo.customerId,
                orderInfo,
                customerInfo,
                timestamp: new Date()
            },
            { merge: true } // Merge to prevent overwriting existing data
        );

        console.log(`Stored order ${orderInfo.orderId} for customer ${customerInfo.customerId}`);
    } catch (error) {
        console.error('Error storing order and customer data:', error);
    }
}

// Webhook route to handle Shopify order payment notifications// Webhook route to handle incoming Shopify order payment notifications
router.post('/webhook/orders/paid', async (req, res) => {
    try {
        const order = req.body; // Shopify sends the order data in the request body

        // Order Information
        const orderInfo = {
            orderId: order.id || null,
            totalPrice: order.total_price || "0.00",
            subtotalPrice: order.subtotal_price || "0.00",
            currency: order.currency || "USD",
            createdAt: order.created_at || null,
            updatedAt: order.updated_at || null,
            lineItems: order.line_items
                ? order.line_items.map(item => ({
                    productId: item.variant_id || null,  // Ensure no undefined values
                    productTitle: item.title || "Unknown Product",
                    quantity: item.quantity || 0,
                    price: item.price || "0.00"
                }))
                : []
        };

        // Customer Information
        const customerInfo = order.customer
            ? {
                customerId: order.customer.id || null,
                firstName: order.customer.first_name || "Unknown",
                lastName: order.customer.last_name || "Unknown",
                email: order.customer.email || "No Email",
                phone: order.customer.phone || "No Phone"
            }
            : { customerId: null };

        // Prevent storing data if required fields are missing
        if (!customerInfo.customerId || !orderInfo.orderId) {
            console.error("❌ Missing customerId or orderId:", { customerInfo, orderInfo });
            return res.status(400).send("Invalid order or customer data.");
        }

        // Store the order and customer ID for future reference
        await storeOrderAndCustomer(orderInfo, customerInfo);

        // Process the order and update the loyalty program (points)
        await updateLoyaltyPoints(customerInfo.customerId, Math.floor(orderInfo.totalPrice), orderInfo.lineItems); // Example: Adding 10 points

        res.status(200).send("✅ Order payment processed successfully.");
    } catch (error) {
        console.error("❌ Error processing order payment webhook:", error);
        res.status(500).send("Internal server error.");
    }
});

module.exports = router;