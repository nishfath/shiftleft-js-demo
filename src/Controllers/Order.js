const crypto = require('crypto');
const https = require('https');
const mail = require('../Integrations/Mail');
require('dotenv').config();

// Retrieve encryption key from environment variables
// The key must be 32 bytes (256 bits) for AES-256
// Generate using: crypto.randomBytes(32).toString('base64')
const getEncryptionKey = () => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  
  // Convert base64 encoded key to buffer
  const keyBuffer = Buffer.from(key, 'base64');
  
  if (keyBuffer.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes for AES-256');
  }
  
  return keyBuffer;
};

class Order {
  hex(key) {
    // Hash Key using SHA-256
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  encryptData(secretText) {
    // Use AES-256-GCM for strong encryption (FIPS 140-2 compliant)
    // Retrieve encryption key from secure source
    const encryptionKey = getEncryptionKey();
    
    // Generate a random initialization vector (IV) for each encryption operation
    // For GCM mode, 12 bytes (96 bits) is the recommended IV length
    const iv = crypto.randomBytes(12);
    
    // Create cipher using AES-256-GCM (Galois/Counter Mode for authenticated encryption)
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    
    // Encrypt the data
    let encrypted = cipher.update(secretText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Get the authentication tag for integrity verification
    const authTag = cipher.getAuthTag();
    
    // Return encrypted data with IV and auth tag (needed for decryption)
    // Format: iv:authTag:encryptedData
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  decryptData(encryptedText) {
    // Use AES-256-GCM instead of DES for strong encryption
    // AES-256-GCM is recommended by NIST and OWASP for symmetric encryption
    
    // Retrieve encryption key from secure source
    const encryptionKey = getEncryptionKey();
    const algorithm = 'aes-256-gcm';
    
    // Parse the encrypted data which should contain IV, auth tag, and encrypted content
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
    
    // Create decipher with AES-256-GCM
    const decipher = crypto.createDecipheriv(algorithm, encryptionKey, iv);
    
    // Set the authentication tag for integrity verification
    decipher.setAuthTag(authTag);
    
    // Decrypt the data
    let decrypted = decipher.update(encryptedData);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  }

  addToOrder(req, res) {
    const order = req.body;
    console.log(req.body);
    if (req.session.orders) {
      const orders = JSON.parse(this.decryptData(req.session.orders));
      order.id = crypto.randomBytes(256).toString('hex');
      orders.push(order);
      req.session.orders = this.encryptData(JSON.stringify(orders));
    }
    res.send(200);
  }

  removeOrder(req, res) {
    const { orderId } = req.body;
    console.log(req.body);
    if (req.session.orders) {
      const orders = JSON.parse(this.decryptData(req.session.orders));
      const newOrders = orders.filter(order => orderId !== order.orderId);
      req.session.orders = this.encryptData(JSON.stringify(newOrders));
      console.log(newOrders);
    }
    res.send(200);
  }

  checkout(req, res) {
    if (req.session.orders) {
      const orders = JSON.parse(this.decryptData(req.session.orders));
      let totalPrice = 0;
      for (let index = 0; index < orders.length; index += 1) {
        totalPrice += orders[index].price;
      }
      this.processCC(req, res, orders, totalPrice);
    }
    console.log(req.session.orders);
  }

  createStripeRequest(creditCard, price, address) {
    // Retrieve API credentials from environment variables
    const STRIPE_CLIENT_ID = process.env.STRIPE_CLIENT_ID;
    const STRIPE_CLIENT_SECRET_KEY = process.env.STRIPE_CLIENT_SECRET_KEY;
    
    if (!STRIPE_CLIENT_ID || !STRIPE_CLIENT_SECRET_KEY) {
      throw new Error('Stripe credentials not configured');
    }
    
    // Use HTTPS and proper authentication headers instead of URL parameters
    const options = {
      hostname: 'api.stripe.com',
      port: 443,
      path: '/v1/charges',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_CLIENT_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    };
    
    const postData = `amount=${price * 100}&currency=usd`;
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        console.log('Payment processed:', data);
      });
    });
    
    req.on('error', (error) => {
      console.error('Payment error:', error);
    });
    
    req.write(postData);
    req.end();
  }

  async processCC(req, res, orders, totalPrice) {
    try {
      const self = this;
      new MongoDBClient().connect(async function(err, client) {
        const username = req.cookies.username;
        const address = req.body.address;
        if (client) {
          const db = client.db('tarpit', { returnNonCachedInstance: true });
          if (!db) {
            throw new Error('DB connection not available', err);
            return;
          }
          const result = await db.collection('users').findOne({
            username
          });
          const transactionId = crypto.randomBytes(256).toString('hex');
          await db
            .collection('orders')
            .insertMany(orders.map(order => ({ ...order, transactionId })));
          const transaction = {
            transactionId,
            date: new Date().valueOf(),
            username,
            cc: result.creditCard,
            shippingAddress: address,
            billingAddress: result.address
          };
          console.log(transaction);
          await db.collection('transactions').insertOne(transaction);
          self.createStripeRequest(
            result.creditCard,
            totalPrice,
            transaction.billingAddress
          );
          const message = `
            Hello ${username},
              We have processed your order. Please visit the following link to review your order
              <a href="https://tarpit.com/orders/${username}?ref=mail&transactionId=${transactionId}">Review Order</a>
          `;
          mail.sendMail(
            'orders@tarpit.com',
            result.email,
            `Order Successfully Processed`,
            message
          );
        } else {
          console.error(err);
        }
      });
    } catch (ex) {
      logger.error(ex);
    }
  }
}

module.exports = new Order();




