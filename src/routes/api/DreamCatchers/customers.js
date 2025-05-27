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

router.post('/toggle/waive-signature', async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const newTag = "waive_signature";
    try {
        const customerId = req.body.customer.id;

        // 1. Fetch Shopify customer
        const response = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/customers/${customerId}.json`, {
            method: 'GET',
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error('Failed to fetch customer data');
            return res.status(500).json({ message: 'Failed to fetch customer data' });
        }

        const customer = await response.json();
        let currentTags = customer.customer.tags.split(',').map(tag => tag.trim());

        let tagToggled;
        if (!currentTags.includes(newTag)) {
            currentTags.push(newTag);
            tagToggled = true;
        } else {
            currentTags = currentTags.filter(tag => tag !== newTag);
            tagToggled = false;
        }

        const updatedTags = currentTags.join(',');

        // 2. Update Shopify customer tags
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

        if (!updateResponse.ok) {
            console.error('Failed to update customer tags');
            return res.status(500).json({ message: 'Failed to update customer tags' });
        }

        // 3. Update Firestore customer doc
        const customerRef = db.collection('customers').doc(`DC-${customerId}`);
        const customerDoc = await customerRef.get();

        if (!customerDoc.exists) {
            return res.status(404).json({ message: 'Customer not found in Firestore' });
        }

        await customerRef.update({
            waive_signature: tagToggled,
            updated_at: new Date()
        });

        res.status(200).json({ message: `Customer waive_signature set to ${tagToggled}` });

    } catch (error) {
        console.error("Error in customer toggle process:", error);
        res.status(500).json({ error: error.message });
    }
});


// POST /webhooks/order-paid
router.post('/webhooks/order-paid', async (req, res) => {
    try {
        const order = req.body;

        if (!order || !order.customer || !order.id) {
            return res.status(400).json({ message: 'Invalid order payload' });
        }

        const customerId = order.customer.id;
        const orderId = order.id;

        let waiveSignature = false;

        // 1. Check Firestore
        const customerRef = db.collection('customers').doc(`DC-${customerId}`);
        const customerDoc = await customerRef.get();
        if (customerDoc.exists && customerDoc.data().waive_signature === true) {
            waiveSignature = true;
        }

        // 2. If not in Firestore, check Shopify tags
        if (!waiveSignature) {
            const shopifyCustomerResponse = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/customers/${customerId}.json`, {
                method: 'GET',
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            });

            if (!shopifyCustomerResponse.ok) {
                throw new Error('Failed to fetch customer from Shopify');
            }

            const customerData = await shopifyCustomerResponse.json();
            const tags = customerData.customer.tags.split(',').map(tag => tag.trim());
            if (tags.includes('waive_signature')) {
                waiveSignature = true;
            }
        }

        // 3. If waiveSignature is true, update the order note
        if (waiveSignature) {
            // First, fetch the existing order to preserve the current note
            const orderDetailsResponse = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/orders/${orderId}.json`, {
                method: 'GET',
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            });

            if (!orderDetailsResponse.ok) {
                throw new Error('Failed to fetch order details from Shopify');
            }

            const orderData = await orderDetailsResponse.json();
            const existingNote = orderData.order.note || '';

            // Avoid duplicating the tag
            const updatedNote = existingNote.includes('Waive_Signature')
                ? existingNote
                : `${existingNote}${existingNote ? ' | ' : ''}Waive_Signature`;

            const updateOrderResponse = await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/orders/${orderId}.json`, {
                method: 'PUT',
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    order: {
                        id: orderId,
                        note: updatedNote
                    }
                })
            });

            if (!updateOrderResponse.ok) {
                throw new Error('Failed to update order with Waive_Signature note');
            }

            console.log(`Order ${orderId} updated with Waive_Signature note.`);
        }


        res.status(200).json({ message: 'Order processed successfully' });
    } catch (error) {
        console.error('Error handling order-paid webhook:', error);
        res.status(500).json({ error: error.message });
    }
});


module.exports = router;