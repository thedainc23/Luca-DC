const express = require('express');
const db = require('../../../config/db'); // Firestore database connection
const router = express.Router();

// Function to update or create customer data, loyalty, and order history in one documentasync function updateCustomerData(customerId, customerDetails, orderInfo, points) {
    try {
        const userRef = db.collection('customers').doc(`DC-${customerId}`);
        const userDoc = await userRef.get();

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
            lastOrder: orderInfo || {}, // Store last order details
            loyalty: {
                points: points || 0,
                stamps: 0
            },
            createdAt: new Date(),
            orderHistory: []
        };

        if (userDoc.exists) {
            // If customer exists, retrieve existing data
            customerData = userDoc.data() || {};

            // Ensure necessary fields exist
            customerData.loyalty = customerData.loyalty || { points: 0, stamps: 0 };
            customerData.orderHistory = customerData.orderHistory || [];
            customerData.totalSpent = customerData.totalSpent || 0;
            customerData.ordersCount = customerData.ordersCount || 0;

            // Update loyalty points
            customerData.loyalty.points += points;

            // Calculate and add stamps (1 stamp for every 5 items)
            const totalItems = orderInfo.lineItems.reduce((acc, item) => acc + item.quantity, 0);
            const newStamps = Math.floor(totalItems / 5);
            customerData.loyalty.stamps += newStamps;

            // Update total spent and orders count
            customerData.totalSpent += parseFloat(orderInfo.totalPrice);
            customerData.ordersCount += 1;

            // Update last order
            customerData.lastOrder = orderInfo;

            // Add order to history (keeping only the last 10 orders for performance)
            customerData.orderHistory.unshift(orderInfo);
            if (customerData.orderHistory.length > 10) {
                customerData.orderHistory.pop();
            }
        }

        // Ensure no undefined values are passed to Firestore
        customerData.orderHistory = customerData.orderHistory.filter(order => order.orderId !== undefined);

        // Save/update Firestore with merged data
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

        // Log the entire incoming order to inspect the data
        console.log("Received Order Data:", JSON.stringify(order, null, 2));

        // Validate the presence of required fields
        if (!order || !order.customer || !order.customer.id || !order.id || !order.total_price || !order.line_items) {
            console.error("❌ Invalid order or missing customer data:", {
                customer: order.customer,
                orderId: order.id,
                totalPrice: order.total_price,
                lineItems: order.line_items
            });
            return res.status(400).send("Invalid order data.");
        }

        // Ensure `order.id`, `order.total_price`, and `order.line_items` are properly accessed
        const customerId = order.customer.id;
        const orderId = order.id; // Ensure this is accessed correctly
        const orderTotal = parseFloat(order.total_price) || 0;
        const lineItems = order.line_items || [];

        // Order Information
        const orderInfo = {
            orderId: orderId,
            totalPrice: orderTotal.toFixed(2),
            currency: order.currency || "USD",
            createdAt: order.created_at || null,
            updatedAt: order.updated_at || null,
            lineItems: lineItems.map(item => ({
                productId: item.variant_id || null,
                productTitle: item.title || "Unknown Product",
                quantity: item.quantity || 0,
                price: parseFloat(item.price).toFixed(2) || "0.00",
                tags: item.tags || []  // Assuming `tags` is an array or field in the `item`
            }))
        };

        // Loyalty points = total dollars spent (can be modified as needed)
        const loyaltyPoints = Math.floor(orderTotal);

        // Store all data under the customer document
        await updateCustomerData(customerId, orderInfo, loyaltyPoints);

        res.status(200).send("✅ Order payment processed successfully.");
    } catch (error) {
        console.error("❌ Error processing order webhook:", error);
        res.status(500).send("Internal server error.");
    }
});

module.exports = router;