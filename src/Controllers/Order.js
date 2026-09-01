const crypto = require('crypto');
const https = require('https');
const mail = require('../Integrations/Mail');

// Retrieve encryption key from environment variables or secure key management service
// The key must be 32 bytes (256 bits) for AES-256-GCM
const getEncryptionKey = () => {
  const keyString = process.env.ENCRYPTION_KEY;
  if (!keyString) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  
  // If the key is base64 encoded in the environment variable
  const keyBuffer = Buffer.from(keyString, 'base64');
  
  if (keyBuffer.length !== 32) {
    throw new Error('Encryption key must be exactly 32 bytes for AES-256');
  }
  
  return keyBuffer;
};

class Order {
  constructor() {
    // Initialize encryption key from secure source
    this.encryptionKey = getEncryptionKey();
  }

  hex(key) {
    // Hash Key using SHA-256 for cryptographic hashing
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  encryptData(secretText) {
    // Use AES-256-GCM for strong authenticated encryption (FIPS 140-2 compliant)
    
    // Generate a random 12-byte initialization vector (IV) for GCM mode
    const iv = crypto.randomBytes(12);
    
    // Create cipher using AES-256-GCM with secure key from environment
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    
    // Encrypt the data
    let encrypted = cipher.update(secretText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Get the authentication tag for integrity verification
    const authTag = cipher.getAuthTag();
    
    // Return encrypted data with IV and auth tag (needed for decryption)
    // Format: iv:authTag:encryptedData (all in hex)
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  decryptData(encryptedText) {
    // Use AES-256-GCM for strong authenticated decryption
    const algorithm = 'aes-256-gcm';
    
    // Parse the encrypted data which contains IV, auth tag, and encrypted content
    // Expected format: iv:authTag:encryptedData (all in hex)
    const parts = encryptedText.split(':');
    
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedData = Buffer.from(parts[2], 'hex');
    
    // Verify IV length (should be 12 bytes for GCM mode)
    if (iv.length !== 12) {
      throw new Error('Invalid IV length');
    }
    
    // Verify auth tag length (should be 16 bytes for GCM)
    if (authTag.length !== 16) {
      throw new Error('Invalid authentication tag length');
    }
    
    // Create decipher with AES-256-GCM using secure key from environment
    const decipher = crypto.createDecipheriv(algorithm, this.encryptionKey, iv);
    
    // Set the authentication tag for integrity verification
    decipher.setAuthTag(authTag);
    
    // Decrypt the data
    let decrypted = decipher.update(encryptedData);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  }

  addToOrder(req, res) {
    try {
      const order = req.body;
      
      if (req.session.orders) {
        const orders = JSON.parse(this.decryptData(req.session.orders));
        order.id = crypto.randomBytes(16).toString('hex');
        orders.push(order);
        req.session.orders = this.encryptData(JSON.stringify(orders));
      } else {
        // Initialize orders array if it doesn't exist
        const orders = [order];
        order.id = crypto.randomBytes(16).toString('hex');
        req.session.orders = this.encryptData(JSON.stringify(orders));
      }
      
      res.status(200).send({ success: true });
    } catch (error) {
      console.error('Error adding order:', error);
      res.status(500).send({ error: 'Failed to add order' });
    }
  }

  removeOrder(req, res) {
    try {
      const { orderId } = req.body;
      
      if (req.session.orders) {
        const orders = JSON.parse(this.decryptData(req.session.orders));
        const newOrders = orders.filter(order => orderId !== order.orderId);
        req.session.orders = this.encryptData(JSON.stringify(newOrders));
      }
      
      res.status(200).send({ success: true });
    } catch (error) {
      console.error('Error removing order:', error);
      res.status(500).send({ error: 'Failed to remove order' });
    }
  }

  checkout(req, res) {
    try {
      if (req.session.orders) {
        const orders = JSON.parse(this.decryptData(req.session.orders));
        let totalPrice = 0;
        
        for (let index = 0; index < orders.length; index += 1) {
          totalPrice += orders[index].price;
        }
        
        this.processCC(req, res, orders, totalPrice);
      } else {
        res.status(400).send({ error: 'No orders found' });
      }
    } catch (error) {
      console.error('Error during checkout:', error);
      res.status(500).send({ error: 'Checkout failed' });
    }
  }

  createStripeRequest(creditCard, price, address) {
    // Retrieve Stripe credentials from environment variables
    const STRIPE_CLIENT_ID = process.env.STRIPE_CLIENT_ID;
    const STRIPE_CLIENT_SECRET_KEY = process.env.STRIPE_CLIENT_SECRET_KEY;
    
    if (!STRIPE_CLIENT_ID || !STRIPE_CLIENT_SECRET_KEY) {
      throw new Error('Stripe credentials not configured in environment variables');
    }
    
    // Use HTTPS for secure communication and proper API endpoint
    const stripeApiEndpoint = process.env.STRIPE_API_ENDPOINT || 'https://api.stripe.com/v1/charges';
    
    // Properly format request data
    const postData = JSON.stringify({
      amount: Math.round(price * 100), // Convert to cents
      currency: 'usd',
      source: creditCard,
      description: 'Order payment'
    });
    
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_CLIENT_SECRET_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    return new Promise((resolve, reject) => {
      const req = https.request(stripeApiEndpoint, options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`Stripe request failed with status ${res.statusCode}`));
          }
        });
      });
      
      req.on('error', (error) => {
        reject(error);
      });
      
      req.write(postData);
      req.end();
    });
  }

  async processCC(req, res, orders, totalPrice) {
    try {
      const MongoDBClient = require('../Database/MongoDBClient');
      
      new MongoDBClient().connect(async (err, client) => {
        if (err) {
          console.error('Database connection error:', err);
          return res.status(500).send({ error: 'Database connection failed' });
        }
        
        const username = req.cookies.username;
        const address = req.body.address;
        
        if (!client) {
          return res.status(500).send({ error: 'Database client not available' });
        }
        
        try {
          const db = client.db('tarpit', { returnNonCachedInstance: true });
          
          if (!db) {
            throw new Error('DB connection not available');
          }
          
          const result = await db.collection('users').findOne({ username });
          
          if (!result) {
            return res.status(404).send({ error: 'User not found' });
          }
          
          const transactionId = crypto.randomBytes(16).toString('hex');
          
          await db
            .collection('orders')
            .insertMany(orders.map(order => ({ ...order, transactionId })));
          
          const transaction = {
            transactionId,
            date: new Date().valueOf(),
            username,
            ccLast4: result.creditCard.slice(-4), // Store only last 4 digits for security
            shippingAddress: address,
            billingAddress: result.address
          };
          
          await db.collection('transactions').insertOne(transaction);
          
          // Process payment through Stripe
          await this.createStripeRequest(
            result.creditCard,
            totalPrice,
            transaction.billingAddress
          );
          
          // Send confirmation email with proper escaping to prevent XSS
          const escapedUsername = username.replace(/[<>&'"]/g, (char) => {
            const escapeMap = {
              '<': '&lt;',
              '>': '&gt;',
              '&': '&amp;',
              "'": '&#39;',
              '"': '&quot;'
            };
            return escapeMap[char];
          });
          
          const message = `
            Hello ${escapedUsername},
              We have processed your order. Please visit the following link to review your order:
              <a href="https://tarpit.com/orders/${encodeURIComponent(username)}?ref=mail&transactionId=${encodeURIComponent(transactionId)}">Review Order</a>
          `;
          
          await mail.sendMail(
            'orders@tarpit.com',
            result.email,
            'Order Successfully Processed',
            message
          );
          
          // Clear orders from session after successful checkout
          delete req.session.orders;
          
          res.status(200).send({ 
            success: true, 
            transactionId,
            message: 'Order processed successfully' 
          });
          
        } catch (dbError) {
          console.error('Database operation error:', dbError);
          res.status(500).send({ error: 'Failed to process order' });
        } finally {
          client.close();
        }
      });
    } catch (ex) {
      console.error('Payment processing error:', ex);
      res.status(500).send({ error: 'Payment processing failed' });
    }
  }
}

module.exports = new Order();





