const express = require('express');
const db = require('../../../config/db'); // Firestore database connection
const router = express.Router();
const axios = require('axios');  // Assuming you're using axios for HTTP requests

// Shopify Store and Access Token
const SHOPIFY_STORE = "www.hairlocs.com";
const SHOPIFY_ACCESS_TOKEN = "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";  // Hairlocs token

// TAGS
router.post('/', async (req, res) => {
    try {
        const order = req.body;
        const customerId = order.customer.id;
        const wholesaleTag = " wholesale";
        const newTag = " new";
        const verifiedTag = " verified";

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
        let currentTags = customer.customer.tags.split(','); // Current tags are separated by commas
        // Check if the new tag is already in the list
        if (!currentTags.includes(newTag) || !currentTags.includes(verifiedTag) || !currentTags.includes(wholesaleTag)) {
            // currentTags.push(wholesaleTag);  // Add the new tag
            res.status(200).json({ message: 'No Tags Detected' });
        }
        else if (currentTags.includes(verifiedTag)) {
            if(currentTags.includes(verifiedTag)){
                currentTags = currentTags.filter(tag => tag !== verifiedTag);  // Remove the tag if it already exists    
            }
            // Removes the new tag if it already exists so we can re add it
            else if(currentTags.includes(wholesaleTag)){
                currentTags = currentTags.filter(tag => tag !== wholesaleTag);  // Remove the tag if it already exists    
            }
            // Add the wholesale tag
            currentTags.push(wholesaleTag);  // Add the new tag
        }
        // else {
        //     currentTags = currentTags.filter(tag => tag !== newTag);  // Remove the tag if it already exists    
        // }
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
            res.status(200).json({ message: 'Customer tags updated successfully' });
        } else {
            console.error('Failed to update customer tags');
            res.status(500).json({ message: 'Customer tags did not update successfully' });
        }
    } catch (error) {
        // console.error('Error fetching loyalty customers:', error);
        res.status(500).json({ error: 'Internal server error, notify your IT department.' });
    }
});

module.exports = router;