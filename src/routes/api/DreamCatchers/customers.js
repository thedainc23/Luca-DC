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


router.post('/check/waive-signature', async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const customer = req.body.customer;
        const customerId = customer.id;
        const customerRef = db.collection('customers').doc(`DC-${customer.toString()}`);
        const customerDoc = await customerRef.get();

        if (customerDoc.exists) {
            return res.status(200).json({ waive_signature: customerDoc.data().waive_signature ? customerDoc.data().waive_signature : false });
        } else {
            return res.status(404).json({ message: 'Customer not found.' });
        }
    } catch (error) {
        console.error("Error in customer fetching and storing process:", error);
        return res.status(500).json({ error: error.message });
    }
});

router.post('/toggle/waive-signature', async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    // let shopUrl = `https://${SHOPIFY_STORE}/admin/api/2023-10/customers.json`;
    const newTag = "waive_signature";
    try {
        // const customer = req.body.customer;
        // const signature = req.body.waive_signature || false;
        const customerId = req.body.customer.id;
        // const customerRef = db.collection('customers').doc(`DC-${customer.toString()}`);
        // const customerDoc = await customerRef.get();

        // if (customerDoc.exists) {
        //     await customerRef.set({ waive_signature: waive_signature }, { merge: true });
        //     return res.status(200).json({ message: 'Signature waiver updated successfully!' });
        // } else {
        //     return res.status(404).json({ message: 'Customer not found.' });
        // }
        // Fetch the current customer data
        const response = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/customers/${customerId}.json`, {
            method: 'GET',
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error('Failed to fetch customer data');
            return; 
        }

        const customer = await response.json();
        const currentTags = customer.customer.tags.split(','); // Current tags are separated by commas

        // Check if the new tag is already in the list
        if (!currentTags.includes(newTag)) {
            currentTags.push(newTag);  // Add the new tag
        }
        else {
            currentTags = currentTags.filter(tag => tag !== newTag);  // Remove the tag if it already exists    
        }

        // Update the customer with the new tags
        const updatedTags = currentTags.join(',');  // Rejoin the tags as a comma-separated string

        const updateResponse = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/customers/${customerId}.json`, {
            method: 'PUT',
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                customer: {
                    id: customerId, 
                    tags: updatedTags
                }
            })
        });

        if (updateResponse.ok) {
            console.log('Customer tags updated successfully');
        } else {
            console.error('Failed to update customer tags');
        }
    } catch (error) {
        console.error("Error in customer fetching and storing process:", error);
        return res.status(500).json({ error: error.message });
    }
});

module.exports = router;