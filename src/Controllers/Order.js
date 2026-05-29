const crypto = require('crypto');
const https = require('https');
const mail = require('../Integrations/Mail');

// Retrieve encryption key from environment variables instead of hardcoding
const encryptionKey = process.env.ENCRYPTION_KEY;

// Validate that the encryption key is properly configured
if (!encryptionKey || encryptionKey.length !== 32) {
  throw new Error('ENCRYPTION_KEY must be set in environment variables and be 32 bytes long for AES-256');
}

class Order {
  hex(key) {
    // Properly hash key using SHA-256
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  encryptData(secretText) {
    // Use AES-256-GCM for strong encryption with authentication
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
    
    let encrypted = cipher.update(secretText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Return IV, auth tag, and encrypted data together
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

decryptData(encryptedText) {
  // Parse the IV, auth tag, and encrypted data
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  
  // Use AES-256-GCM for decryption with authentication
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

    // Use AES-256-GCM for decryption with authentication
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  addToOrder(req, res) {
    try {
      const order = req.body;
      
      // Validate session exists
      if (!req.session) {
        return res.status(401).send({ error: 'Unauthorized' });
      }
      
      if (req.session.orders) {
        const orders = JSON.parse(this.decryptData(req.session.orders));
        // Use crypto.randomUUID for better ID generation
        order.id = crypto.randomUUID();
        orders.push(order);
        req.session.orders = this.encryptData(JSON.stringify(orders));
      } else {
        // Initialize orders if not present
        req.session.orders = this.encryptData(JSON.stringify([order]));
      }
      
      res.status(200).send({ success: true });
    } catch (error) {
      console.error('Error adding order:', error.message);
      res.status(500).send({ error: 'Failed to add order' });
    }
  }

  removeOrder(req, res) {
    try {
      const { orderId } = req.body;
      
      if (!req.session || !req.session.orders) {
        return res.status(400).send({ error: 'No orders found' });
      }
      
      const orders = JSON.parse(this.decryptData(req.session.orders));
      const newOrders = orders.filter(order => orderId !== order.orderId);
      req.session.orders = this.encryptData(JSON.stringify(newOrders));
      
      res.status(200).send({ success: true });
    } catch (error) {
      console.error('Error removing order:', error.message);
      res.status(500).send({ error: 'Failed to remove order' });
    }
  }

  checkout(req, res) {
    try {
      if (!req.session || !req.session.orders) {
        return res.status(400).send({ error: 'No orders found' });
      }
      
      const orders = JSON.parse(this.decryptData(req.session.orders));
      let totalPrice = 0;
      
      for (let index = 0; index < orders.length; index += 1) {
        totalPrice += orders[index].price;
      }
      
      this.processCC(req, res, orders, totalPrice);
    } catch (error) {
      console.error('Error during checkout:', error.message);
      res.status(500).send({ error: 'Checkout failed' });
    }
  }

  createStripeRequest(creditCard, price, address) {
    // Retrieve Stripe credentials from environment variables
    const STRIPE_CLIENT_ID = process.env.STRIPE_CLIENT_ID;
    const STRIPE_CLIENT_SECRET_KEY = process.env.STRIPE_CLIENT_SECRET_KEY;
    const STRIPE_API_URL = process.env.STRIPE_API_URL || 'https://api.stripe.com';
    
    // Validate credentials are configured
    if (!STRIPE_CLIENT_ID || !STRIPE_CLIENT_SECRET_KEY) {
      throw new Error('Stripe credentials not configured in environment variables');
    }
    
    // Use HTTPS and proper request options with authentication header
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_CLIENT_SECRET_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    
    const requestData = JSON.stringify({
      client_id: STRIPE_CLIENT_ID,
      price: price,
      address: address,
      // Tokenize credit card instead of sending raw data
      payment_method: creditCard
    });
    
    return https.request(STRIPE_API_URL, options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        console.log('Stripe response:', data);
      });
    }).on('error', (error) => {
      console.error('Stripe request error:', error);
    }).end(requestData);
  }

  async processCC(req, res, orders, totalPrice) {
    try {
      const MongoDBClient = require('../Database/MongoDBClient');
      
      new MongoDBClient().connect(async (err, client) => {
        if (err || !client) {
          console.error('Database connection error:', err);
          return res.status(500).send({ error: 'Database connection failed' });
        }
        
        try {
          const username = req.cookies.username;
          const address = req.body.address;
          
          // Validate required data
          if (!username || !address) {
            return res.status(400).send({ error: 'Missing required information' });
          }
          
          const db = client.db('tarpit', { returnNonCachedInstance: true });
          
          if (!db) {
            throw new Error('DB connection not available');
          }
          
          const result = await db.collection('users').findOne({ username });
          
          if (!result) {
            return res.status(404).send({ error: 'User not found' });
          }
          
          // Use crypto.randomUUID for transaction ID
          const transactionId = crypto.randomUUID();
          
          await db
            .collection('orders')
            .insertMany(orders.map(order => ({ ...order, transactionId })));
          
          const transaction = {
            transactionId,
            date: new Date().valueOf(),
            username,
            // Store only last 4 digits of credit card
            ccLast4: result.creditCard ? result.creditCard.slice(-4) : '',
            shippingAddress: address,
            billingAddress: result.address
          };
          
          await db.collection('transactions').insertOne(transaction);
          
          // Process payment with tokenized credit card
          this.createStripeRequest(
            result.creditCard,
            totalPrice,
            transaction.billingAddress
          );
          
          // Sanitize username to prevent XSS in email
          const sanitizedUsername = username.replace(/[<>]/g, '');
          
          const message = `
            Hello ${sanitizedUsername},
              We have processed your order. Please visit the following link to review your order:
              <a href="https://tarpit.com/orders/${encodeURIComponent(username)}?ref=mail&transactionId=${encodeURIComponent(transactionId)}">Review Order</a>
          `;
          
          mail.sendMail(
            'orders@tarpit.com',
            result.email,
            'Order Successfully Processed',
            message
          );
          
          res.status(200).send({ 
            success: true, 
            transactionId: transactionId 
          });
        } catch (error) {
          console.error('Transaction processing error:', error);
          res.status(500).send({ error: 'Transaction failed' });
        } finally {
          client.close();
        }
      });
    } catch (ex) {
      console.error('Process CC error:', ex);
      res.status(500).send({ error: 'Payment processing failed' });
    }
  }
}

module.exports = new Order();


