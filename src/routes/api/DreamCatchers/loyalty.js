const express = require('express');
const db = require('../../../config/db'); // Firestore database connection
const router = express.Router();
const axios = require('axios');  // Assuming you're using axios for HTTP requests

const SHOPIFY_STORE = "www.dreamcatchers.com";
const SHOPIFY_ACCESS_TOKEN = "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";  // Your token

// Function to fetch variants from Firestore's 4N1 collection by variant_id
async function fetchVariantFrom4N1(variantId) {
    const variantRef = db.collection('4N1').doc(variantId.toString());
    const variantDoc = await variantRef.get();
    
    if (variantDoc.exists) {
        return variantDoc.data();  // Return the variant data if found
    } else {
        return null; // Return null if the variant is not found
    }
}
// Function to fetch product from Firestore's hair_extensions collection by productId
async function fetchProductFromHairExtensions(productId) {
    if (!productId) {
        console.error('❌ Invalid productId: ', productId);
        return null;  // Return null if the productId is invalid or missing
    }

    try {
        const productRef = db.collection('hair_extensions').doc(productId.toString());
        const productDoc = await productRef.get();

        if (productDoc.exists) {
            console.log(`✅ Product found: ${productId}`);
            return productDoc.data();  // Return the product data if found
        } else {
            console.warn(`⚠️ Product not found: ${productId}`);
            return null;  // Return null if the product does not exist
        }
    } catch (error) {
        console.error(`❌ Error fetching product ${productId}: `, error);
        return null;  // Return null in case of any error during the Firestore fetch
    }
}

// Function to store a new client if they don't exist
async function storeClient(customerDetails) {
    try {
        const { customerId, firstName, lastName, email, phone, totalSpent, ordersCount, acceptsMarketing, tags, defaultAddress, addresses, lastOrder } = customerDetails;

        const userRef = db.collection('customers').doc(`DC-${customerId}`);
        const userDoc = await userRef.get();

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

        console.log(`✅ Customer ${customerId} created successfully.`);
    } catch (error) {
        console.error('❌ Error storing customer data:', error);
    }
}

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

        // Iterate through the line items and match products that include "FREE" in the title
        for (const item of orderInfo.lineItems) {
            const productTitle = item.productTitle || "";  // Default to empty string if title is missing
            const quantity = item.quantity || 0;  // Default to 0 if quantity is missing
        
            // Log the raw product title to check its value
            console.log(`Checking raw product title: '${productTitle}'`);
        
            // Trim any whitespace from product title before checking
            const trimmedProductTitle = productTitle.trim();
        
            // Log the trimmed product title to verify no extra spaces
            console.log(`Checking trimmed product title: '${trimmedProductTitle}'`);
        
            // Check if productTitle contains "FREE" (case-insensitive)
            if (trimmedProductTitle.includes("FREE")) {
                console.log(`Matched FREE product: ${trimmedProductTitle} with quantity ${quantity}`);
                totalFreeProducts += quantity;  // Count the quantity of "FREE" items
            } else {
                console.log(`No match for FREE in product: ${trimmedProductTitle}`);
            }
        }
        

        // Calculate stamps: 1 stamp for every 5 matching "FREE" items
        // const newStamps = Math.floor(totalFreeProducts / 5);
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

// Webhook to handle Shopify order payment notifications
router.post('/webhook/orders/paid', async (req, res) => {
    try {
        const order = req.body;
        console.log("Received Order Data:", JSON.stringify(order, null, 2));

        // Validate required fields
        if (!order || !order.customer || !order.customer.id || !order.id || !order.total_price || !order.line_items) {
            console.error("❌ Invalid order or missing customer data:", {
                customer: order.customer,
                orderId: order.id,
                totalPrice: order.total_price,
                lineItems: order.line_items
            });
            return res.status(400).send("Invalid order data.");
        }

        const customerId = order.customer.id;
        const orderId = order.id;
        const orderTotal = parseFloat(order.total_price) || 0;
        const lineItems = order.line_items.map(item => ({
            productId: item.variant_id || null,
            productTitle: item.title || "Unknown Product",
            quantity: item.quantity || 0,
            price: parseFloat(item.price).toFixed(2) || "0.00",
            tags: Array.isArray(item.tags) ? item.tags : [] // Ensure tags is an array
        }));

        const orderInfo = {
            orderId,
            totalPrice: orderTotal.toFixed(2),
            currency: order.currency || "USD",
            createdAt: order.created_at || null,
            updatedAt: order.updated_at || null,
            lineItems
        };

        const customerDetails = {
            customerId: customerId,
            firstName: order.customer.first_name || "Unknown",
            lastName: order.customer.last_name || "Unknown",
            email: order.customer.email || "",
            phone: order.customer.phone || "",
            totalSpent: parseFloat(order.customer.total_spent) || 0,
            ordersCount: order.customer.orders_count || 0,
            acceptsMarketing: order.customer.accepts_marketing || false,
            tags: order.customer.tags || [],
            defaultAddress: order.customer.default_address || {},
            addresses: order.customer.addresses || [],
            lastOrder: orderInfo
        };

        // If the customer doesn't exist, create the customer first
        const userRef = db.collection('customers').doc(`DC-${customerId}`);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            // If the customer does not exist, store the customer
            await storeClient(customerDetails);
        }

        // Update customer data, including loyalty and order history
        await updateCustomerData(customerId, customerDetails, orderInfo);

        res.status(200).send("✅ Order processed successfully.");
    } catch (error) {
        console.error("❌ Error processing order webhook:", error);
        res.status(500).send("Internal server error.");
    }
});

// Express route to get loyalty points for a customer
router.post('/loyalty-points/refund', async (req, res) => {
    try {
        const order = req.body;
        console.log(order)
        // Query the database for loyalty points using the customerId
        // const userRef = db.collection('customers').doc(`DC-${customerId}`);
        // const userDoc = await userRef.get();

        // if (!userDoc.exists) {
        //     return res.status(404).send({ error: 'Customer not found' });
        // }

        // const customerData = userDoc.data();
        // const loyaltyPoints = customerData.loyalty.points || 0;

        // res.status(200).send({ loyaltyPoints });
    } catch (error) {
        console.error('Error fetching loyalty points:', error);
        res.status(500).send({ error: 'Internal server error' });
    }
});


// Express route to get loyalty points for a customer
router.get('/loyalty-points/:customerId', async (req, res) => {
    try {
        const { customerId } = req.params;

        // Query the database for loyalty points using the customerId
        const userRef = db.collection('customers').doc(`DC-${customerId}`);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).send({ error: 'Customer not found' });
        }

        const customerData = userDoc.data();
        const loyaltyPoints = customerData.loyalty.points || 0;

        res.status(200).send({ loyaltyPoints });
    } catch (error) {
        console.error('Error fetching loyalty points:', error);
        res.status(500).send({ error: 'Internal server error' });
    }
});

module.exports = router;