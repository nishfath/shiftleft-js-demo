const crypto = require('crypto');
const https = require('https');
const mail = require('../Integrations/Mail');

const encryptionKey = "This is a simple key, don't guess it";
class Order {
  hex(key) {
    // Hash Key
    return key;
  }
  encryptData(secretText) {
    // Weak encryption
    const desCipher = crypto.createCipheriv('des', encryptionKey);
    return desCipher.update(secretText, 'utf8', 'hex');
  }

  decryptData(encryptedText) {
    const desCipher = crypto.createDecipheriv('des', encryptionKey);
    return desCipher.update(encryptedText);
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

async createStripeRequest(creditCard, price, address) {
  // Retrieve sensitive credentials from environment variables instead of hardcoding
  const STRIPE_CLIENT_ID = process.env.STRIPE_CLIENT_ID;
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  
  // Validate that required environment variables are set
  if (!STRIPE_CLIENT_ID || !STRIPE_SECRET_KEY) {
    throw new Error('Stripe credentials are not configured');
  }
  
  // Prepare request payload - use POST body instead of GET query parameters for sensitive data
  const payload = {
    clientId: STRIPE_CLIENT_ID,
    price: price,
    address: address
  };
  
  // Set proper headers with authorization
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${STRIPE_SECRET_KEY}`
  };
  
  try {
    // Use HTTPS protocol with proper request method (POST instead of GET)
    // Send sensitive data in request body, not in URL
    const response = await axios.post(
      'https://api.stripe.com/v1/payment_intents',
      payload,
      { headers: headers }
    );
    
    return response.data;
  } catch (error) {
    // Log error securely without exposing sensitive information
    console.error('Payment processing error:', error.message);
    throw new Error('Failed to process payment');
  }
}

    );
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
          this.createStripeRequest(
            result.creditCard,
            totalPrice,
            transaction.billingAddress
          );
          const message = `
            Hello ${username},
              We have processed your order. Please visit the following link to review your order
              <a href="https://tarpit.com/orders/${username}?ref=mail&transactionId=${transactionId}}">Review Order</a>
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
