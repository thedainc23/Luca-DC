const express = require('express');
const db = require('../../../config/db'); // Firebase DB setup
const router = express.Router();
const axios = require('axios');  // HTTP client for API requests

// Shopify Store and Access Token
const SHOPIFY_STORE = 'www.dreamcatchers.com';
const SHOPIFY_ACCESS_TOKEN = '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';
const HAIR_COLLECTION_ID = 394059120886; // Replace with the specific collection ID you want to fetch

router.post('/sync-shopify', async (req, res) => {
    // Shopify API URL to fetch products from the specific collection
    const shopifyUrl = `https://${SHOPIFY_STORE}/admin/api/2023-10/collections/${HAIR_COLLECTION_ID}/products.json`;
    try {
        // Fetch data from Shopify API
        const response = await axios.get(shopifyUrl, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
            },
        });

        const products = response.data.products;
        
        // Store products in Firebase Firestore
        const batch = db.batch();  // Use batch writes for atomic operations
        
        products.forEach((product) => {
            const productRef = db.collection('hair_extensions').doc(product.id.toString());

            batch.set(productRef, {
                id: product.id,
                title: product.title,
                description: product.body_html,
                vendor: product.vendor,
                product_type: product.product_type,
                handle: product.handle,
                created_at: product.created_at,
                updated_at: product.updated_at,
                published_at: product.published_at,
                tags: product.tags || [],  // Collect tags, default to empty array if no tags

                // Ensure images is an array before calling .map()
                images: Array.isArray(product.images) ? product.images.map(image => ({
                    src: image.src,
                    alt: image.alt || '',
                })) : [], // Default to empty array if no images

                // Ensure variants is an array before calling .map()
                variants: Array.isArray(product.variants) ? product.variants.map(variant => ({
                    id: variant.id,
                    title: variant.title,
                    price: variant.price,
                    sku: variant.sku,
                    inventory_quantity: variant.inventory_quantity,
                    weight: variant.weight,
                    barcode: variant.barcode,
                })) : [], // Default to empty array if no variants

                // Ensure options is an array before calling .map()
                options: Array.isArray(product.options) ? product.options.map(option => ({
                    name: option.name,
                    values: option.values,
                })) : [], // Default to empty array if no options

                metafields: product.metafields || [],  // Collect metafields (custom data)

                // Collect pricing and weight information from the first variant
                price: product.variants[0]?.price,  // First variant's price
                compare_at_price: product.variants[0]?.compare_at_price, // First variant's comparison price
                weight_unit: product.variants[0]?.weight_unit, // First variant's weight unit
            });
            
        });

        // Commit the batch write
        await batch.commit();

        console.log('Shopify products synced with Firebase successfully');
        return res.status(200).send({ message: 'Shopify products synced with Firebase successfully' });

    } catch (error) {
        console.error('Error syncing Shopify products: ', error.response ? error.response.data : error.message);
        return res.status(500).send({ error: 'Error syncing Shopify products', details: error.response ? error.response.data : error.message });
    }
});






// API to store customer data if it doesn't exist
router.post('/storeClient', async (req, res) => {
    try {
        const {
            customerId, firstName, lastName, email, phone, totalSpent, ordersCount,
            acceptsMarketing, tags, defaultAddress, addresses, lastOrder
        } = req.body;

        if (!customerId || !firstName || !lastName || !email) {
            return res.status(400).send({ error: 'Missing required customer data' });
        }

        const userRef = db.collection('customers').doc(`DC-${customerId}`);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            console.log(`Customer ${customerId} already exists.`);
            return res.status(200).send({ message: 'Customer already exists' });
        } else {
            // Check for existing loyalty data
            const loyaltyRef = db.collection('loyalty').doc(`DC-${customerId}`);
            const loyaltyDoc = await loyaltyRef.get();
            const loyaltyData = loyaltyDoc.exists ? loyaltyDoc.data().loyalty : { points: 0, stamps: 0 };

            // Store all customer data, including loyalty info
            await userRef.set({
                customerId,
                firstName,
                lastName,
                email,
                phone,
                totalSpent,
                ordersCount,
                acceptsMarketing,
                tags: tags || [],
                defaultAddress: defaultAddress || {},
                addresses: addresses || [],
                lastOrder: lastOrder || {},
                loyalty: loyaltyData,  // Include loyalty points & stamps
                createdAt: new Date(),
            });

            console.log(`Customer ${customerId} added successfully with full data.`);
            return res.status(200).send({ message: 'Customer added successfully' });
        }
    } catch (error) {
        console.error('Error storing customer data:', error);
        return res.status(500).send({ error: 'Internal server error' });
    }
});

module.exports = router;