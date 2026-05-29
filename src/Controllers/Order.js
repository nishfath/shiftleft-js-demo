const crypto = require('crypto');
const https = require('https');
const mail = require('../Integrations/Mail');
require('dotenv').config();

// Retrieve encryption key from environment variables instead of hardcoding
const encryptionKey = process.env.ENCRYPTION_KEY;

// Validate encryption key exists and has proper length for AES-256
if (!encryptionKey || Buffer.from(encryptionKey, 'hex').length !== 32) {
  throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
}

class Order {
  hex(key) {
    // Proper hash implementation using SHA-256
    return crypto.createHash('sha256').update(key).digest('hex');
  }

encryptData(secretText) {
  // Use AES-256-GCM instead of DES for strong encryption
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
  
  let encrypted = cipher.update(secretText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Return IV, auth tag, and encrypted data together
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

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
    
    // Use AES-256-GCM for decryption
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  addToOrder(req, res) {
    const order = req.body;
    console.log(req.body);
    if (req.session.orders) {
      const orders = JSON.parse(this.decryptData(req.session.orders));
      order.id = crypto.randomBytes(16).toString('hex');
      orders.push(order);
      req.session.orders = this.encryptData(JSON.stringify(orders));
    }
    res.sendStatus(200);
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
    console.log(req.session.orders);
  }

  createStripeRequest(creditCard, price, address) {
    // Retrieve Stripe credentials from environment variables
    const STRIPE_CLIENT_ID = process.env.STRIPE_CLIENT_ID;
    const STRIPE_CLIENT_SECRET_KEY = process.env.STRIPE_CLIENT_SECRET_KEY;
    
    // Validate credentials exist
    if (!STRIPE_CLIENT_ID || !STRIPE_CLIENT_SECRET_KEY) {
      throw new Error('Stripe credentials not configured');
    }
    
    // Use HTTPS instead of HTTP for secure communication
    // Use POST instead of GET to avoid exposing credentials in URL
    const postData = JSON.stringify({
      price: price,
      address: address
    });
    
    const options = {
      hostname: 'api.stripe.com',
      port: 443,
      path: '/v1/charges',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `Bearer ${STRIPE_CLIENT_SECRET_KEY}`
      }
    };
    
    const req = https.request(options, (res) => {
      console.log(`statusCode: ${res.statusCode}`);
    });
    
    req.on('error', (error) => {
      console.error(error);
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
          const transactionId = crypto.randomBytes(16).toString('hex');
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

