const express = require('express');
const db = require('../../../config/db'); // Firestore database connection
const router = express.Router();
const axios = require('axios');  // Assuming you're using axios for HTTP requests

// Shopify Store and Access Token
const SHOPIFY_STORE = 'www.dreamcatchers.com';
const SHOPIFY_ACCESS_TOKEN = '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';

const axiosConfig = {
    headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
    },
};

router.post('/hair-extensions', async (req, res) => {
    const HAIR_COLLECTION_ID = 394059120886;
    // Shopify API URL to fetch products from the specific collection
    const shopifyUrl = `https://${SHOPIFY_STORE}/admin/api/2023-10/collections/${HAIR_COLLECTION_ID}/products.json`;

    try {
        // Fetch products from the collection
        const response = await axios.get(shopifyUrl, axiosConfig);

        const products = response.data.products;

        if (!products || products.length === 0) {
            return res.status(200).send({ message: 'No products found in the specified collection' });
        }

        // Initialize a batch write to Firebase Firestore
        const batch = db.batch();

        // Loop through products
        for (const product of products) {
            const productRef = db.collection('hair_extensions').doc(product.id.toString());

            // First store the main product information
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
                tags: product.tags ? product.tags.split(',') : [], // Store tags as an array
                images: Array.isArray(product.images) ? product.images.map(image => ({
                    src: image.src,
                    alt: image.alt || '',
                })) : [], // Ensure images are in array format
                options: Array.isArray(product.options) ? product.options.map(option => ({
                    name: option.name,
                    values: Array.isArray(option.values) ? option.values : [], // Ensure values is an array
                })) : [], // Default to empty array if no options
                metafields: product.metafields || [],  // Collect metafields (custom data)
            });

            // Fetch variants for the product
            const variantUrl = `https://${SHOPIFY_STORE}/admin/api/2023-10/products/${product.id}/variants.json`;
            try {
                const variantResponse = await axios.get(variantUrl, {
                    headers: {
                        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                    },
                });

                const variants = variantResponse.data.variants;

                if (Array.isArray(variants) && variants.length > 0) {
                    // Now handle the variants and store them in a separate collection `4N1`
                    variants.forEach((variant) => {
                        const variantRef = db.collection('4N1').doc(variant.id.toString());  // Create a new document for each variant
                        
                        // Store variant information
                        batch.set(variantRef, {
                            product_id: product.id,  // Link to the parent product
                            variant_id: variant.id,
                            title: variant.title,
                            price: variant.price,
                            sku: variant.sku,
                            inventory_quantity: variant.inventory_quantity,
                            weight: variant.weight,
                            weight_unit: variant.weight_unit,
                            barcode: variant.barcode || '', // Null safe
                            compare_at_price: variant.compare_at_price,
                            created_at: variant.created_at,
                            updated_at: variant.updated_at,
                            image_id: variant.image_id || '', // Null safe
                            admin_graphql_api_id: variant.admin_graphql_api_id,
                        });
                    });
                } else {
                    console.log(`No variants found for product: ${product.id}`);
                }
            } catch (variantError) {
                console.error(`Error fetching variants for product ${product.id}: `, variantError.message);
            }
        }

        // Commit the batch write for both products and variants
        await batch.commit();

        console.log('Shopify products and variants synced with Firebase successfully');
        return res.status(200).send({ message: 'Shopify products and variants synced with Firebase successfully' });

    } catch (error) {
        // Detailed error logging
        console.error('Error syncing Shopify products: ', error.response ? error.response.data : error.message);
        return res.status(500).send({ error: 'Error syncing Shopify products', details: error.response ? error.response.data : error.message });
    }
});

module.exports = router;