const crypto = require('crypto');
const https = require('https');
const mail = require('../Integrations/Mail');

// Retrieve encryption key from environment variables (32 bytes for AES-256)
// Key should be stored in a secure location like AWS Secrets Manager, Azure Key Vault, or environment variables
const getEncryptionKey = () => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  // Ensure the key is exactly 32 bytes for AES-256
  const keyBuffer = Buffer.from(key, 'base64');
  if (keyBuffer.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (base64 encoded)');
  }
  return keyBuffer;
};

class Order {
  hex(key) {
    // Use SHA-256 for proper hashing
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  encryptData(secretText) {
    // Use AES-256-GCM for strong encryption as recommended by NIST
    const algorithm = 'aes-256-gcm';
    const encryptionKey = getEncryptionKey();
    
    // Generate a random 12-byte IV for GCM mode
    const iv = crypto.randomBytes(12);
    
    // Create cipher with AES-256-GCM
    const cipher = crypto.createCipheriv(algorithm, encryptionKey, iv);
    
    // Encrypt the data
    let encrypted = cipher.update(secretText, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    // Get the authentication tag for integrity verification
    const authTag = cipher.getAuthTag();
    
    // Return format: iv:authTag:encryptedData (all in hex)
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decryptData(encryptedText) {
    // Use AES-256-GCM instead of DES for strong encryption
    // AES-256-GCM is recommended by NIST and OWASP for symmetric encryption
    const algorithm = 'aes-256-gcm';
    const encryptionKey = getEncryptionKey();
    
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
    
    // Verify auth tag length (should be 16 bytes for GCM mode)
    if (authTag.length !== 16) {
      throw new Error('Invalid authentication tag length');
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
    // Remove console.log to prevent sensitive data exposure
    if (req.session.orders) {
      const orders = JSON.parse(this.decryptData(req.session.orders));
      order.id = crypto.randomBytes(32).toString('hex');
      orders.push(order);
      req.session.orders = this.encryptData(JSON.stringify(orders));
    } else {
      // Initialize orders array if not exists
      req.session.orders = this.encryptData(JSON.stringify([order]));
    }
    res.sendStatus(200);
  }

  removeOrder(req, res) {
    const { orderId } = req.body;
    if (req.session.orders) {
      const orders = JSON.parse(this.decryptData(req.session.orders));
      const newOrders = orders.filter(order => orderId !== order.orderId);
      req.session.orders = this.encryptData(JSON.stringify(newOrders));
    }
    res.sendStatus(200);
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
  }

  createStripeRequest(creditCard, price, address) {
    // Retrieve Stripe credentials from environment variables
    const STRIPE_CLIENT_ID = process.env.STRIPE_CLIENT_ID;
    const STRIPE_CLIENT_SECRET_KEY = process.env.STRIPE_CLIENT_SECRET_KEY;
    
    if (!STRIPE_CLIENT_ID || !STRIPE_CLIENT_SECRET_KEY) {
      throw new Error('Stripe credentials not configured');
    }
    
    // Use HTTPS instead of HTTP for secure communication
    // Use proper authorization headers instead of query parameters
    const postData = JSON.stringify({
      price: price,
      address: address
    });
    
    const options = {
      hostname: 'api.stripe.com',
      port: 443,
      path: '/v1/payment_intents',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `Bearer ${STRIPE_CLIENT_SECRET_KEY}`
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        // Handle response
      });
    });
    
    req.on('error', (error) => {
      console.error('Stripe API error:', error);
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
          const transactionId = crypto.randomBytes(32).toString('hex');
          await db
            .collection('orders')
            .insertMany(orders.map(order => ({ ...order, transactionId })));
          const transaction = {
            transactionId,
            date: new Date().valueOf(),
            username,
            // Do not log sensitive credit card information
            shippingAddress: address,
            billingAddress: result.address
          };
          await db.collection('transactions').insertOne(transaction);
          self.createStripeRequest(
            result.creditCard,
            totalPrice,
            transaction.billingAddress
          );
          // Sanitize username to prevent XSS attacks
          const sanitizedUsername = username.replace(/[<>]/g, '');
          const message = `
            Hello ${sanitizedUsername},
              We have processed your order. Please visit the following link to review your order
              <a href="https://tarpit.com/orders/${encodeURIComponent(username)}?ref=mail&transactionId=${transactionId}">Review Order</a>
          `;
          mail.sendMail(
            'orders@tarpit.com',
            result.email,
            `Order Successfully Processed`,
            message
          );
          res.sendStatus(200);
        } else {
          console.error(err);
          res.sendStatus(500);
        }
      });
    } catch (ex) {
      console.error(ex);
      res.sendStatus(500);
    }
  }
}

module.exports = new Order();



