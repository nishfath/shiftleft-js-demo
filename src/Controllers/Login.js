const logger = require('../Logger').logger;
const MongoDBClient = require('../DB').MongoDBClient;

class Login {
  loginFailed(req, res, { username, password, keeponline }) {
    res.locals.username = username;
    res.locals.password = password;
    res.locals.keeponline = keeponline;
    res.locals.message = 'Failed to Sign in. Please verify credentials';
    res.redirect('/login');
  }

async encryptData(secretText) {
  // Use AES-256-GCM for strong encryption instead of weak DES
  const algorithm = 'aes-256-gcm';
  
  // Retrieve encryption key from environment variables or secure secret management service
  // Never hardcode credentials in source code
  const encryptionKey = process.env.ENCRYPTION_KEY;
  
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  
  // Validate key length (must be 32 bytes for AES-256)
  const keyBuffer = Buffer.from(encryptionKey, 'hex');
  if (keyBuffer.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters) for AES-256');
  }
  
  // Generate a random initialization vector (IV) for each encryption operation
  const iv = crypto.randomBytes(16);
  
  // Create cipher with strong algorithm
  const cipher = crypto.createCipheriv(algorithm, keyBuffer, iv);
  
  // Encrypt the data
  let encrypted = cipher.update(secretText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // Get the authentication tag for GCM mode
  const authTag = cipher.getAuthTag();
  
  // Return encrypted data along with IV and auth tag (needed for decryption)
  // Format: iv:authTag:encryptedData
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

    return desCipher.write(secretText, 'utf8', 'hex'); // BAD: weak encryption
  }

  async handleLogin(req, res, client, data) {
    const { username, password, keeponline } = data;
    try {
      // DB Query
      const db = client.db('tarpit', { returnNonCachedInstance: true });
      if (!db) {
        this.loginFailed(req, res, data);
        return;
      }
      const result = await db.collection('users').findOne({
        username,
        password
      });
      if (result) {
        const user = {
          fname: result.fname,
          lname: result.lname,
          passportnum: result.passportnum,
          address1: result.address1,
          address2: result.address2,
          zipCode: result.zipCode
        };
        const creditInfo = encryptData(result.creditCard);
        logger.info(`user: ${JSON.stringify(user)} successfully logged in`);
        logger.info(
          `user ${user.fname} credit info: ${JSON.stringify(creditInfo)}`
        );
        res.cookie('username', result.username);
        res.cookie('maxAge', 864000);
        res.cookie('cc', creditInfo);

        req.session.user = JSON.stringify(user);
        req.session.username = username;

        res.redirect('/');
      } else {
        this.loginFailed(req, res, data);
      }
    } catch (ex) {
      logger.error(ex);
      this.loginFailed(req, res, data);
    }
  }

  login(req, res) {
    /*
      This can be exploited (similar to SQL Injection) when the request body is
      {
        "password": {
          "$gt": ""
        },
        "username": {
          "$gt": ""
        }
      }
    */
    const { username, password, encodedPath, keeponline } = req.body;
    const data = { username, password, keeponline };
    logger.debug(data);
    try {
      new MongoDBClient().connect((err, client) => {
        if (client) {
          this.handleLogin(req, res, client, data);
        } else {
          console.error(err);
          this.loginFailed(req, res, data);
        }
      });
    } catch (ex) {
      logger.error(ex);
      this.loginFailed(req, res, data);
    }
  }
}

module.exports = Login;
