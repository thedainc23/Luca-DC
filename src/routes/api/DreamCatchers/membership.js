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


// Webhook to handle Shopify order payment notifications
router.post('/webhook/orders/paid', async (req, res) => {
    try {
        const order = req.body;
        // console.log("Received Order Data:", JSON.stringify(order, null, 2));

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
            productId: item.product_id || null,
            varientID: item.variant_id || null,
            productTitle: item.title || "Unknown Product",
            productName: item.name || "Unknown Product",
            quantity: item.quantity || 0,
            price: parseFloat(item.price).toFixed(2) || "0.00",
            tags: Array.isArray(item.tags) ? item.tags : [], // Ensure tags is an array
            sku: item.sku || null,
            discountCodes: order.discount_applications || [],
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
            await storeClient(customerDetails, orderInfo);
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
        const order =  req.body.order_id;
        const url = `https://${SHOPIFY_STORE}/admin/api/2023-01/orders/${order}.json`;
        const response = await axios.get(`https://${SHOPIFY_STORE}/admin/api/2023-04/orders/${order}.json`, {
            headers: {
              'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
            },
          });
        
          // Handle the response
          console.log(response.data);
        
          // Extract customer ID
          const customer = response.data.order.customer.id;
        const lineItems = req.body.refund_line_items.map(item => ({
            productId: item.line_item.product_id || null,
            varientID: item.line_item.variant_id || null,
            productTitle: item.line_item.title || "Unknown Product",
            productName: item.line_item.name || "Unknown Product",
            quantity: item.quantity || 0,
            price: parseFloat(item.line_item.price).toFixed(2) || "0.00",
            tags: Array.isArray(item.line_item.tags) ? item.line_item.tags : [], // Ensure tags is an array
            sku: item.line_item.sku || null,
        }));
        const userRef = db.collection('customers').doc(`DC-${customer}`);
        const userDoc = await userRef.get();
        const userData = userDoc.data();
        let currentStamps = userData.loyalty.stamps;

         // Initialize total matching products count for "FREE" products
         let totalFreeProducts = 0;

         for (const item of lineItems) {
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

        if(totalFreeProducts > 0){
            currentStamps = currentStamps - totalFreeProducts;  // Add stamps to the customer's loyalty points
        // Update Firestore with the new or updated customer data
            await userRef.update({
                'loyalty.stamps': currentStamps
            });
            const refunds = db.collection('refunds').doc(`DC-${req.body.order_id}`);
            await refunds.set(req.body);
        }
        res.status(200).send("✅ Refund processed, points and stamps deducted.");
    } catch (error) {
        console.error("❌ Error processing refund:", error);
        res.status(500).send("Internal server error.");
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
        const loyaltyStamps = customerData.loyalty.stamps || 0;

        res.status(200).send({ loyaltyPoints, loyaltyStamps });
    } catch (error) {
        console.error('Error fetching loyalty points:', error);
        res.status(500).send({ error: 'Internal server error' });
    }
});












async function getAllCustomers(batchSize = 500) {
    const customers = [];
    let lastDoc = null;
    let query = db.collection('customers').orderBy('__name__').limit(batchSize);

    while (true) {
        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }

        const snapshot = await query.get();
        if (snapshot.empty) break;

        snapshot.forEach(doc => {
            customers.push({
                id: doc.id,
                ...doc.data()
            });
        });

        lastDoc = snapshot.docs[snapshot.docs.length - 1];

        // Optional: Log progress
        console.log(`Fetched ${customers.length} customers so far...`);
    }

    return customers;
}

// Get Customers from Firestore
router.get('/all-customers', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const last = req.query.last; // Pass the last doc's ID

        let query = db.collection('customers').orderBy('createdAt').limit(limit);

        if (last) {
            const lastDoc = await db.collection('customers').doc(last).get();
            query = query.startAfter(lastDoc);
        }

        const snapshot = await query.get();
        const customers = [];

        snapshot.forEach(doc => {
            customers.push({
                id: doc.id,
                ...doc.data()
            });
        });

        res.status(200).json(customers);
    } catch (error) {
        console.error('Error fetching customers:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


router.get('/loyalty-customers', async (req, res) => {
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