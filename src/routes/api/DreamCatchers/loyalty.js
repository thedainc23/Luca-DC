const express = require('express');
const { validationResult } = require('express-validator');
const axios = require('axios');  // Import axios
const db = require('../../../config/db');
const router = express.Router();

const SHOPIFY_STORE = "www.dreamcatchers.com";
const SHOPIFY_ACCESS_TOKEN = "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";  // Your token

// Function to log detailed error messages
function logError(error) {
    if (error.response) {
        // Log the full response error from Shopify API
        console.error("Shopify Error Response:", error.response.data);
        console.error("Status Code:", error.response.status); // Log status code
    } else if (error.request) {
        // If no response was received from Shopify API
        console.error("No response received from Shopify:", error.request);
    } else {
        // Log general error message
        console.error("Error:", error.message);
    }
}

// Function to fetch today's orders from Shopify
async function fetchTodaysOrders() {
    try {
        // Get today's date in ISO 8601 format
        const today = new Date();
        const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
        const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();

        const url = `https://${SHOPIFY_STORE}/admin/api/2023-10/orders.json?created_at_min=${startOfDay}&created_at_max=${endOfDay}`;

        const response = await axios.get(url, {
            headers: {
                "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
            },
        });

        return response.data.orders; // Return orders for today
    } catch (error) {
        logError(error); // Log the error for debugging
        throw new Error('Failed to fetch today\'s orders from Shopify.');
    }
}

// Function to store orders in Firestore
async function storeOrdersInFirestore(orders) {
    try {
        for (let order of orders) {
            const orderRef = db.collection('orders').doc(order.id.toString());
            await orderRef.set(order); // Store the order data in Firestore
        }
        console.log("Orders stored in Firestore!");
    } catch (error) {
        console.error("Error storing orders in Firestore:", error);
        throw new Error('Failed to store orders in Firestore.');
    }
}

// Route to trigger the fetch and store of Shopify orders
router.get('/', async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const orders = await fetchTodaysOrders(); // Fetch today's orders
        if (orders && orders.length > 0) {
            await storeOrdersInFirestore(orders); // Store orders in Firestore
            return res.status(200).json({ message: 'Orders successfully fetched and stored!' });
        } else {
            return res.status(404).json({ message: 'No orders found for today.' });
        }
    } catch (error) {
        console.error("Error in order fetching and storing process:", error);
        return res.status(500).json({ error: error.message });
    }
});

module.exports = router;