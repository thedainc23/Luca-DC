const express = require('express');
const db = require('../../../config/db'); // Firebase DB setup
const router = express.Router();
const axios = require('axios');  // HTTP client for API requests

// Shopify Store and Access Token
const SHOPIFY_STORE = 'www.dreamcatchers.com';
const SHOPIFY_ACCESS_TOKEN = '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';

// API to store customer data if it doesn't exist
router.post('/', async (req, res) => {
    try {
        const {
            customerId, firstName, lastName, email, phone, totalSpent, ordersCount,
            acceptsMarketing, tags, defaultAddress, addresses, lastOrder
        } = req.body;

        if (!customerId || !firstName || !lastName || !email) {
            return res.status(400).send({ error: 'Missing required customer data' });
        }

        const userRef = db.collection('customers').doc(`DC-${customerId}`);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            console.log(`Customer ${customerId} already exists.`);
            return res.status(200).send({ message: 'Customer already exists' });
        } else {
            // Check for existing loyalty data
            const loyaltyRef = db.collection('loyalty').doc(`DC-${customerId}`);
            const loyaltyDoc = await loyaltyRef.get();
            const loyaltyData = loyaltyDoc.exists ? loyaltyDoc.data().loyalty : { points: 0, stamps: 0 };

            // Store all customer data, including loyalty info
            await userRef.set({
                customerId,
                firstName,
                lastName,
                email,
                phone,
                totalSpent,
                ordersCount,
                acceptsMarketing,
                tags: tags || [],
                defaultAddress: defaultAddress || {},
                addresses: addresses || [],
                lastOrder: lastOrder || {},
                loyalty: loyaltyData,  // Include loyalty points & stamps
                createdAt: new Date(),
            });

            console.log(`Customer ${customerId} added successfully with full data.`);
            return res.status(200).send({ message: 'Customer added successfully' });
        }
    } catch (error) {
        console.error('Error storing customer data:', error);
        return res.status(500).send({ error: 'Internal server error' });
    }
});

module.exports = router;