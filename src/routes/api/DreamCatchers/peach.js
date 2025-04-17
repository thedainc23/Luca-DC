const express = require('express');
const db = require('../../../config/db'); // Firestore database connection
const router = express.Router();
const axios = require('axios');  // Assuming you're using axios for HTTP requests

// Shopify Store and Access Token
const SHOPIFY_STORE = "www.dreamcatchers.com";
const SHOPIFY_ACCESS_TOKEN = "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";  // Your token

// Function to update or create customer data, loyalty, and order history
async function updateCustomerData(customerId, customerDetails, orderInfo) {
    try {
        const userRef = db.collection('customers').doc(`DC-${customerId}`);
        const userDoc = await userRef.get();

        // Get the total price from the order and add it as points
        const totalSpent = Math.floor(orderInfo.totalPrice) || 0;

        let customerData = {
            customerId: customerId,
            firstName: customerDetails.firstName || "Unknown",
            lastName: customerDetails.lastName || "Unknown",
            email: customerDetails.email || "",
            phone: customerDetails.phone || "",
            totalSpent: parseFloat(customerDetails.totalSpent) || 0,
            ordersCount: customerDetails.ordersCount || 0,
            acceptsMarketing: customerDetails.acceptsMarketing || false,
            tags: customerDetails.tags || [],
            defaultAddress: customerDetails.defaultAddress || {},
            addresses: customerDetails.addresses || [],
            lastOrder: orderInfo || {},
            loyalty: {
                points: totalSpent || 0,  // Points from totalPrice of the order
                stamps: 0
            },
            createdAt: new Date(),
            orderHistory: []
        };

        // Initialize total matching products count for "FREE" products
        let totalFreeProducts = 0;

        for (const item of orderInfo.lineItems) {
            const productTitle = item.productName;  // Default to empty string if title is missing, and trim spaces
            const quantity = item.quantity || 0;  // Default to 0 if quantity is missing
            console.log(productTitle)
            // Log the raw product title and quantity to check its value
            console.log(`Checking raw product title: '${productTitle}' | Quantity: ${quantity}`);
              // Split the product title into an array of words
            const wordsInTitle = productTitle.split(" ");  // Splitting by spaces
            // Check if the product title contains "FREE" (case-sensitive)
            if (productTitle.includes("FREE - ")) {
                console.log(`Matched FREE product: ${productTitle} with quantity ${quantity}`);
                totalFreeProducts += 1;  // Add the quantity of matching products to the total
            }
        }

        customerData.loyalty.stamps += totalFreeProducts;  // Add stamps to the customer's loyalty points

        // If the customer document exists, update the data
        if (userDoc.exists) {
            customerData = userDoc.data() || {};
            customerData.loyalty = customerData.loyalty || { points: 0, stamps: 0 };
            customerData.orderHistory = customerData.orderHistory || [];
            customerData.totalSpent = customerData.totalSpent || 0;
            customerData.ordersCount = customerData.ordersCount || 0;

            // Update the loyalty points based on the totalSpent (points = total price)
            customerData.loyalty.points += totalSpent;
            customerData.loyalty.stamps += totalFreeProducts;  
            customerData.totalSpent += totalSpent;  // Add total price to the customer's total spent
            customerData.ordersCount += 1;
            customerData.lastOrder = orderInfo;
            customerData.orderHistory.unshift(orderInfo);

            // Limit the order history to the most recent 10 orders
            if (customerData.orderHistory.length > 10) {
                customerData.orderHistory.pop();
            }
        }

        // Clean up order history, ensuring valid orderId
        customerData.orderHistory = customerData.orderHistory.filter(order => order.orderId !== undefined);

        // Update Firestore with the new or updated customer data
        await userRef.set(customerData, { merge: true });

        console.log(`✅ Customer ${customerId} data updated successfully.`);
    } catch (error) {
        console.error('❌ Error updating customer data:', error);
    }
}



// Function to store a new client if they don't exist
async function storeClient(customerDetails, orderInfo) {
    try {
        const { customerId, firstName, lastName, email, phone, totalSpent, ordersCount, acceptsMarketing, tags, defaultAddress, addresses, lastOrder } = customerDetails;

        const userRef = db.collection('customers').doc(`DC-${customerId}`);
        const userDoc = await userRef.get();
        const loyaltyData = { points: 0, stamps: 0 };

        if (userDoc.exists) {
            console.log(`Customer ${customerId} already exists.`);
            return; // No need to create again
        }

     await userRef.set({
            customerId,
            firstName,
            lastName,
            email,
            phone,
            totalSpent: parseFloat(totalSpent) || 0,
            ordersCount: ordersCount || 0,
            acceptsMarketing: acceptsMarketing || false,
            tags: tags || [],
            defaultAddress: defaultAddress || {},
            addresses: addresses || [],
            lastOrder: lastOrder || {},
            loyalty: loyaltyData,
            createdAt: new Date(),
            orderHistory: []
        });

        updateCustomerData(customerId, customerDetails, orderInfo);  // Update the customer data

        console.log(`✅ Customer ${customerId} created successfully.`);
    } catch (error) {
        console.error('❌ Error storing customer data:', error);
    }
}

router.get('/sync', async (req, res) => {
    try {
        const customersRef = db.collection('customers');
        const snapshot = await customersRef.get();

        const loyaltyCustomers = [];

        snapshot.forEach(doc => {
            const data = doc.data();

            // Check if `loyalty.stamps > 0`
            if (data.loyalty && data.loyalty.stamps > 0) {
                loyaltyCustomers.push({
                    id: doc.id,
                    ...data
                });
            }
        });

        res.status(200).json(loyaltyCustomers); // Send only loyalty customers
    } catch (error) {
        console.error('Error fetching loyalty customers:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;