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

// 🔒 Hardcoded Zoom secret token
const ZOOM_SECRET_TOKEN = 'EL1bVBTlQwijoPfQRBrp_g';

router.post('/zoom', async (req, res) => {
  try {
    const { event, payload } = req.body;

    // 🔐 Step 1: Handle Zoom URL validation (Challenge-Response)
    if (event === 'endpoint.url_validation') {
      const plainToken = payload.plainToken;
      const hashForValidate = crypto.createHmac('sha256', ZOOM_SECRET_TOKEN)
        .update(plainToken)
        .digest('hex');

      console.log('🔐 Responding to Zoom validation');
      return res.status(200).json({ plainToken, encryptedToken: hashForValidate });
    }

    // 🔒 Step 2: Verify the webhook request using the x-zm-signature header
    const message = `v0:${req.headers['x-zm-request-timestamp']}:${JSON.stringify(req.body)}`;
    const hashForVerify = crypto.createHmac('sha256', ZOOM_SECRET_TOKEN)
      .update(message)
      .digest('hex');
    const signature = `v0=${hashForVerify}`;

    if (req.headers['x-zm-signature'] !== signature) {
      console.log('❌ Invalid Zoom signature');
      return res.status(401).send('Unauthorized');
    }

    // 🎯 Step 3: Handle real Zoom events
    const eventType = event;
    const zoomData = payload?.object;

    if (eventType === 'meeting.started' || eventType === 'webinar.started') {
      const topic = zoomData.topic;
      const hostEmail = zoomData.host_email;

      console.log(`✅ Zoom event received: ${eventType} | ${topic}`);

      /*
      const klaviyoResponse = await axios.post('https://a.klaviyo.com/api/track', {
        token: 'YOUR_KLAVIYO_PUBLIC_API_KEY',
        event: 'QA Started',
        customer_properties: { $email: hostEmail },
        properties: {
          topic,
          zoom_meeting_id: zoomData.id,
          start_time: zoomData.start_time,
        }
      });

      console.log('✅ Klaviyo event sent:', klaviyoResponse.data);
      */
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('❌ Error handling Zoom webhook:', err);
    res.status(500).send('Error');
  }
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


router.post('/store-answer', async (req, res) => {
  const { answer, stylistName, customerId, email } = req.body;

  if (!answer || !customerId || !email) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // 🔹 1. Save response to Firestore
    await db.collection('popup_answers').doc(customerId.toString()).set({
      answer,
      stylistName: stylistName || null,
      customerId,
      email,
      timestamp: new Date()
    });

    // 🔹 2. Fetch existing customer info from Shopify
    const customerRes = await axios.get(
      `https://${SHOPIFY_STORE}/admin/api/2023-10/customers/${customerId}.json`,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    const customer = customerRes.data.customer;
    const existingTags = customer.tags
      ? customer.tags.split(',').map(tag => tag.trim())
      : [];

    // 🔹 3. Add 'popup_seen' if not already present
    if (!existingTags.includes('popup_seen')) {
      existingTags.push('popup_seen');
    }

    // 🔹 4. Prepare customer update payload
    const updatedCustomer = {
      id: customerId,
      tags: existingTags.join(', ')
    };

    // Optional: include name/email to avoid Shopify rejecting empty fields
    if (customer.email) updatedCustomer.email = customer.email;
    if (customer.first_name) updatedCustomer.first_name = customer.first_name;

    // 🔹 5. Update customer tags in Shopify
    const updateRes = await axios.put(
      `https://${SHOPIFY_STORE}/admin/api/2023-10/customers/${customerId}.json`,
      { customer: updatedCustomer },
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    // 🔹 6. Log updated tags for verification
    console.log('✅ Updated tags:', updateRes.data.customer.tags);

    return res.json({ success: true });
  } catch (error) {
    console.error('❌ Error saving popup answer or tagging customer:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/qr', async (req, res) => {
    const text = req.query.text || 'https://dreamcatchers.com/pages/recommendations';
  
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
      const { email, line_items, tags = [] } = req.body;
  
      if (!email || !Array.isArray(line_items) || line_items.length === 0) {
        console.log('[!] Missing email or line_items');
        return res.status(400).json({ error: 'Missing email or line_items' });
      }
  
      // 1. Fetch customer by email
      const customerSearchResp = await shopifyApi.get(`/customers/search.json?query=email:${email}`);
      const customer = customerSearchResp.data.customers[0];
  
      if (!customer) {
        return res.status(404).json({ error: 'Customer not found' });
      }
  
      // 2. Check tag from API or fallback to customer tags
      const tagList = [...(customer.tags || []), ...(tags || [])].map(t => t.toLowerCase());
      const applyUpcharge = tagList.includes('nc_stylist');
      console.log(`[✓] Found customer: ${customer.id} (${customer.email}), Apply Upcharge: ${applyUpcharge}`);
  
      // 3. Build line items
      const adjustedLineItems = line_items.map(item => ({
        variant_id: item.variant_id,
        quantity: item.quantity,
      }));
  
      if (applyUpcharge) {
        const subtotal = line_items.reduce((sum, item) => {
          const price = parseFloat(item.price || '0');
          const qty = parseInt(item.quantity || 1);
          return sum + price * qty;
        }, 0);
  
        const upchargeAmount = +(subtotal * 0.1).toFixed(2); // cast to number
  
        adjustedLineItems.push({
          title: 'NC Stylist 10% Upcharge',
          price: upchargeAmount,
          quantity: 1,
          taxable: true,
        });
      }
  
      // 4. Create draft order
      const draftResp = await shopifyApi.post('/draft_orders.json', {
        draft_order: {
          line_items: adjustedLineItems,
          customer: { id: customer.id },
          use_customer_default_address: true,
        },
      });
  
      const invoiceUrl = draftResp.data.draft_order.invoice_url;
      return res.json({ checkout_url: invoiceUrl });
  
    } catch (error) {
      console.error('🔥 Error in /upsell:', error.response?.data || error.message);
      return res.status(500).json({ error: 'Failed to create upsell order.' });
    }
  });
  
    



module.exports = router;