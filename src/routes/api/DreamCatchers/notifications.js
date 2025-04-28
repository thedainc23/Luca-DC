const express = require('express');
const db = require('../../../config/db'); // Firestore database connection
const router = express.Router();
const axios = require('axios');  // Assuming you're using axios for HTTP requests

// Shopify Store and Access Token
const SHOPIFY_STORE = "www.dreamcatchers.com";
const SHOPIFY_ACCESS_TOKEN = "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";  // Your token

router.post('/', async (req, res) => {
    try {
      const data = req.body;
      const notificationsRef = db.collection('notify_me').doc(`${data.product_id}`);
      const docSnapshot = await notificationsRef.get();
  
      if (docSnapshot.exists) {
        const currentData = docSnapshot.data();
        const updatedWaitingList = currentData.waitingList || [];
  
       // Find if the customer already exists in the waitingList
        const existingCustomerIndex = updatedWaitingList.findIndex(
            (customer) => customer.customer_id === data.customer_id
        );
        
        const customerData = {
            customer_id: data.customer_id || '',
            email: data.email || '',
            first_name: data.first_name || '',
            last_name: data.last_name || '',
            phone: data.phone || '',
            customer_tags: data.customer_tags || '',
        };
        
        if (existingCustomerIndex !== -1) {
            // Customer exists → Update their info
            updatedWaitingList[existingCustomerIndex] = customerData;
        } else {
            // Customer does not exist → Add new customer
            updatedWaitingList.push(customerData);
        }
  
  
        await notificationsRef.update({
          waitingList: updatedWaitingList,
          updatedAt: new Date()
        });
  
        res.status(200).json({ message: 'Added customer to waiting list' });
      } else {
        await notificationsRef.set({
          product_id: data.product_id,
          product_title: data.product_title,
          createdAt: new Date(),
          updatedAt: new Date(),
          waitingList: [{
            customer_id: data.customer_id || '',
            email: data.email || '',
            first_name: data.first_name || '',
            last_name: data.last_name || '',
            phone: data.phone || '',
            customer_tags: data.customer_tags || '',
          }]
        });
        res.status(200).json({ message: 'Created new notification document' });
      }
    } catch (error) {
      console.error('Error handling notification request:', error);
      res.status(500).json({ error: 'Internal server error, please notify IT.' });
    }
  });
  

module.exports = router;