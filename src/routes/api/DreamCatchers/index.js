const express = require('express');
const db = require('../../../config/db'); // Firebase DB setup
const router = express.Router();

// API to store customer data if it doesn't exist
router.post('/storeClient', async (req, res) => {
    try {
        const { customerId, firstName, lastName, email, phone, addresses } = req.body;

        if (!customerId || !firstName || !lastName || !email) {
            return res.status(400).send({ error: 'Missing required customer data' });
        }

        const userRef = db.collection('customers').doc(`DC-${customerId.toString()}`);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            // Customer already exists, do nothing
            console.log(`Customer ${customerId} already exists.`);
            return res.status(200).send({ message: 'Customer already exists' });
        } else {
            // Add the customer to the database if they don't exist
            await userRef.set({
                customerId,
                firstName,
                lastName,
                email,
                phone,
                addresses: addresses || [],  // You can store addresses if provided
                createdAt: new Date(),
            });
            console.log(`Customer ${customerId} added successfully.`);
            return res.status(200).send({ message: 'Customer added successfully' });
        }
    } catch (error) {
        console.error('Error storing customer data:', error);
        return res.status(500).send({ error: 'Internal server error' });
    }
});

module.exports = router;