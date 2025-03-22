const express = require('express');
const db = require('../../../config/db'); // Firestore or database connection
const axios = require('axios');
const router = express.Router();

// Your loyalty program service (this will be your logic to add points)
async function updateLoyaltyPoints(customerId, points) {
    try {
        const userRef = db.collection('users').doc(customerId);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            let loyaltyData = userDoc.data().loyalty || { points: 0, stamps: 0 };

            loyaltyData.points += points; // Adding points, customize as needed
            // You can also manage stamps if you have a stamp-based loyalty system
            // loyaltyData.stamps += 1;

            await userRef.update({ loyalty: loyaltyData });
            console.log(`Loyalty points updated for customer ${customerId}`);
        } else {
            console.log('Customer not found');
        }
    } catch (error) {
        console.error('Error updating loyalty points:', error);
    }
}

// Webhook route to handle incoming Shopify order creation notifications
router.post('/webhook/orders', async (req, res) => {
    try {
        const order = req.body; // Shopify sends the order data in the request body
        const orderId = order.id;
        const customerId = order.customer.id;

        console.log(`Received order ${orderId} for customer ${customerId}`);

        // Process the order and update the loyalty program (points or stamps)
        await updateLoyaltyPoints(customerId, 10); // For example, adding 10 points for every order

        res.status(200).send('Order processed successfully');
    } catch (error) {
        console.error('Error processing order webhook:', error);
        res.status(500).send('Internal server error');
    }
});

module.exports = router;