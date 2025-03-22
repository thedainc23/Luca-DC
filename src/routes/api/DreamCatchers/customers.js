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

async function fetchCustomers() {
    try {
        let customers = [];
        let url = `https://${SHOPIFY_STORE}/admin/api/2023-10/customers.json`;
        
        // Fetch the first page of customers
        let response = await axios.get(url, {
            headers: {
                "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
            },
        });

        // Append the customers to the array
        customers = customers.concat(response.data.customers);

        // Check if there is a next page
        while (response.data.hasOwnProperty('next_page')) {
            // Get the URL for the next page of customers
            url = response.data.next_page;
            response = await axios.get(url, {
                headers: {
                    "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
                },
            });

            // Append the customers from the next page
            customers = customers.concat(response.data.customers);
        }

        return customers; // Return all customers

    } catch (error) {
        logError(error); // Log the error for debugging
        throw new Error('Failed to fetch customer data from Shopify.');
    }
}

// Function to store customers in Firestore
async function storeCustomersInFirestore(customers) {
    try {
        for (let customer of customers) {
            const customerRef = db.collection('customers').doc(customer.id.toString());
            await customerRef.set(customer); // Store the customer data in Firestore
        }
        console.log("Customers stored in Firestore!");
    } catch (error) {
        console.error("Error storing customers in Firestore:", error);
        throw new Error('Failed to store customers in Firestore.');
    }
}

// Route to trigger the fetch and store of Shopify customers
router.get('/', async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const customers = await fetchCustomers(); // Fetch customer data
        if (customers && customers.length > 0) {
            await storeCustomersInFirestore(customers); // Store customers in Firestore
            return res.status(200).json({ message: 'Customers successfully fetched and stored!' });
        } else {
            return res.status(404).json({ message: 'No customers found.' });
        }
    } catch (error) {
        console.error("Error in customer fetching and storing process:", error);
        return res.status(500).json({ error: error.message });
    }
});

module.exports = router;