const express = require('express');
const db = require('../../../config/db'); // Firebase DB setup
const router = express.Router();
const axios = require('axios');  // HTTP client for API requests
const QRCode = require('qrcode');

// Shopify Store and Access Token
const SHOPIFY_STORE = 'www.dreamcatchers.com';
const SHOPIFY_ACCESS_TOKEN = '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';
const HAIR_COLLECTION_ID = 394059120886; // Replace with the specific collection ID you want to fetch
// Shopify API URL to fetch products from the specific collection


const shopifyApi = axios.create({
    baseURL: `https://${SHOPIFY_STORE}/admin/api/2024-01`,
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
      'Content-Type': 'application/json',
    },
});




router.post('/sync-shopify', async (req, res) => {
    const shopifyUrl = `https://${SHOPIFY_STORE}/admin/api/2023-10/collections/${HAIR_COLLECTION_ID}/products.json`;

    try {
        // Fetch products from the collection
        const response = await axios.get(shopifyUrl, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
            },
        });

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



// router.post('/sync-shopify', async (req, res) => {
//     // Shopify API URL to fetch products from the specific collection
//     const shopifyUrl = `https://${SHOPIFY_STORE}/admin/api/2023-10/collections/${HAIR_COLLECTION_ID}/products.json`;
//     try {
//         // Fetch data from Shopify API
//         const response = await axios.get(shopifyUrl, {
//             headers: {
//                 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
//             },
//         });

//         const products = response.data.products;
        
//         // Store products in Firebase Firestore
//         const batch = db.batch();  // Use batch writes for atomic operations
        
//         products.forEach((product) => {
//             const productRef = db.collection('hair_extensions').doc(product.id.toString());

//             batch.set(productRef, {
//                 id: product.id,
//                 title: product.title,
//                 description: product.body_html,
//                 vendor: product.vendor,
//                 product_type: product.product_type,
//                 handle: product.handle,
//                 created_at: product.created_at,
//                 updated_at: product.updated_at,
//                 published_at: product.published_at,
//                 tags: product.tags || [],  // Collect tags, default to empty array if no tags

//                 // Ensure images is an array before calling .map() and accessing index 0
//                 images: Array.isArray(product.images) ? product.images.map(image => ({
//                     src: image.src,
//                     alt: image.alt || '',
//                 })) : [], // Default to empty array if no images

//                 // Ensure variants is an array before accessing index 0
//                 variants: Array.isArray(product.variants) ? product.variants.map(variant => ({
//                     id: variant.id,
//                     title: variant.title,
//                     price: variant.price,
//                     sku: variant.sku,
//                     inventory_quantity: variant.inventory_quantity,
//                     weight: variant.weight,
//                     barcode: variant.barcode,
//                 })) : [], // Default to empty array if no variants

//                 // Collect the first variant's price, compare_at_price, and weight_unit if available
//                 price: product.variants && product.variants.length > 0 ? product.variants[0].price : null,  // First variant's price
//                 compare_at_price: product.variants && product.variants.length > 0 ? product.variants[0].compare_at_price : null, // First variant's comparison price
//                 weight_unit: product.variants && product.variants.length > 0 ? product.variants[0].weight_unit : null, // First variant's weight unit

//                 // Ensure options is an array before calling .map()
//                 options: Array.isArray(product.options) ? product.options.map(option => ({
//                     name: option.name,
//                     values: Array.isArray(option.values) ? option.values : [], // Ensure values is an array
//                 })) : [], // Default to empty array if no options

//                 metafields: product.metafields || [],  // Collect metafields (custom data)
//             });
            
//         });

//         // Commit the batch write
//         await batch.commit();

//         console.log('Shopify products synced with Firebase successfully');
//         return res.status(200).send({ message: 'Shopify products synced with Firebase successfully' });

//     } catch (error) {
//         console.error('Error syncing Shopify products: ', error.response ? error.response.data : error.message);
//         return res.status(500).send({ error: 'Error syncing Shopify products', details: error.response ? error.response.data : error.message });
//     }
// });






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
            const loyaltyData = loyaltyDoc.exists ? loyaltyDoc.data().loyalty : { points: 0, stamps: 0 , count: 0}; // Default to 0 points and stamps if not found

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



router.get('/qr', async (req, res) => {
    const text = req.query.text || 'https://dreamcatchers.com';
  
    try {
      const qrDataUrl = await QRCode.toDataURL(text);
  
      // Send a simple HTML page with the QR code image
      res.send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; margin-top: 50px;">
            <h2>QR Code for: ${text}</h2>
            <img src="${qrDataUrl}" alt="QR Code" />
          </body>
        </html>
      `);
    } catch (err) {
      console.error('QR Code generation error:', err);
      res.status(500).send('Failed to generate QR code.');
    }
});



router.post('/upsell', async (req, res) => {
    try {
        const customerId = req.body.customer?.id;
        const lineItems = req.body.order?.lineItems;
        
  
      if (!customerId || !Array.isArray(lineItems)) {
        console.log('[!] Missing customerId or lineItems');
        return res.status(400).json({ error: 'Missing customerId or lineItems' });
      }
  
      console.log(`[✓] Received request for customerId: ${customerId}`);
      console.log(`[✓] Line Items:`, lineItems);
  
      // 1. Fetch customer to check tags
      const customerResp = await shopifyApi.get(`/customers/${customerId}.json`);
      const customer = customerResp.data.customer;
      const tags = customer.tags || '';
  
      console.log(`[✓] Customer Tags: ${tags}`);
  
      const applyUpcharge = tags.includes('nc_stylist');
      console.log(`[✓] Apply 10% Upcharge: ${applyUpcharge}`);
  
      // 2. Base line items (keep inventory tracking)
      const adjustedLineItems = lineItems.map(item => ({
        variant_id: item.variant_id,
        quantity: item.quantity,
      }));
  
      // 3. Add surcharge line if applicable
      if (applyUpcharge) {
        const subtotal = lineItems.reduce((sum, item) => {
          const price = parseFloat(item.price || '0');
          const qty = parseInt(item.quantity || 1);
          return sum + price * qty;
        }, 0);
  
        const upchargeAmount = (subtotal * 0.1).toFixed(2);
        console.log(`[+] Calculated 10% Upcharge: $${upchargeAmount}`);
  
        adjustedLineItems.push({
          title: 'NC Stylist 10% Upcharge',
          price: upchargeAmount,
          quantity: 1,
        });
  
        console.log(`[+] Final Line Items with Upcharge:`, adjustedLineItems);
      } else {
        console.log(`[✓] No upcharge applied. Final Line Items:`, adjustedLineItems);
      }
  
      // 4. Create draft order
      const draftOrderResp = await shopifyApi.post('/draft_orders.json', {
        draft_order: {
          line_items: adjustedLineItems,
          customer: {
            id: customerId,
          },
          use_customer_default_address: true,
        },
      });
  
      const invoiceUrl = draftOrderResp.data.draft_order.invoice_url;
      console.log(`[✓] Draft order created. Checkout URL: ${invoiceUrl}`);
  
      return res.json({ checkout_url: invoiceUrl });
  
    } catch (error) {
      console.error('🔥 Error in /upsell:', error.response?.data || error.message);
      return res.status(500).json({ error: 'Failed to create upsell order.' });
    }
  });
  
  



module.exports = router;