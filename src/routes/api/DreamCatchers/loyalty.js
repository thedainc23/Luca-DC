const express = require('express');
const db = require('../../../config/db'); // Firestore or database connection
const router = express.Router();

// Function to update loyalty points
async function updateLoyaltyPoints(customerId, points) {
    try {
        const userRef = db.collection('loyalty').doc(`DC-${customerId.toString()}`);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            let loyaltyData = userDoc.data().loyalty || { points: 0, stamps: 0 };

            loyaltyData.points += points; // Adding points, customize as needed
            await userRef.update({ loyalty: loyaltyData });
        } else {
            let loyaltyData = userDoc.data().loyalty || { points: 0, stamps: 0 };
            await userRef.update({ loyalty: loyaltyData });
        }
    } catch (error) {
        console.error('Error updating loyalty points:', error);
    }
}

// Function to store the order and customer ID for later reference
async function storeOrderAndCustomer(orderInfo, customerInfo) {
    try {
        const orderRef = db.collection('loyalty').doc(`DC-${customerInfo.customerId.toString()}`);
        await orderRef.set({ orderId: orderInfo.orderId, customerId: customerInfo.customerId, orderInfo, customerInfo, timestamp: new Date() });

    } catch (error) {
        console.error('Error storing order and customer data:', error);
    }
}

// Webhook route to handle incoming Shopify order payment notifications
router.post('/webhook/orders/paid', async (req, res) => {
    try {
        const order = req.body; // Shopify sends the order data in the request body

        // Order Information
        const orderInfo = {
            orderId: order.id,
            totalPrice: order.total_price,
            subtotalPrice: order.subtotal_price,
            currency: order.currency,
            createdAt: order.created_at,
            updatedAt: order.updated_at,
            lineItems: order.line_items.map(item => ({
                productTitle: item.title,
                quantity: item.quantity,
                price: item.price
            }))
        };

        // Customer Information
        const customerInfo = {
            customerId: order.customer.id,
            firstName: order.customer.first_name,
            lastName: order.customer.last_name,
            email: order.customer.email,
            phone: order.customer.phone
        };

        // Store the order and customer ID for future reference
        await storeOrderAndCustomer(orderInfo, customerInfo);

        // Process the order and update the loyalty program (points)
        await updateLoyaltyPoints(customerInfo.customerId, 10); // For example, adding 10 points for every paid order

        res.status(200).send('Order payment processed successfully');
    } catch (error) {
        console.error('Error processing order payment webhook:', error);
        res.status(500).send('Internal server error');
    }
});

module.exports = router;