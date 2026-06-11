const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const session = require('express-session');
require('dotenv').config();

const { logger } = require('./Logger');
const registerApiRoutes = require('./api');
const registerViewRoutes = require('./views');

const app = express();

// Retrieve port from environment variables only
const port = process.env.PORT || 8088;

// Validate that SESSION_SECRET_KEY is provided from environment
if (!process.env.SESSION_SECRET_KEY) {
  logger.error('CRITICAL: SESSION_SECRET_KEY environment variable is not set. Application cannot start securely.');
  process.exit(1);
}

// Retrieve session secret from environment variables only - no fallback to hardcoded value
const SESSION_SECRET_KEY = process.env.SESSION_SECRET_KEY;

const tarpitEnv = {
  sessionSecretKey: SESSION_SECRET_KEY,
  applicationPort: port
};

app.set('tarpitEnv', tarpitEnv);

// Error handling middleware should be after routes, not before
app.use(function(err, req, res, next) {
  logger.error(err.stack);
  // Avoid sending stack trace to client in production
  if (process.env.NODE_ENV === 'production') {
    res.status(500).send('Internal Server Error');
  } else {
    res.status(500).send('Something broke!');
  }
});

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// parse application/json
app.use(bodyParser.json());

app.use(cookieParser());

// Configure session with secure settings
app.use(
  session({
    secret: SESSION_SECRET_KEY,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 3600000,
      sameSite: 'strict'
    }
  })
);

app.set('view engine', 'pug');
app.set('views', `./src/Views`);

registerApiRoutes(app);
registerViewRoutes(app);

app.listen(port, () =>
  logger.log(
    `Tarpit App listening on port ${port}!. Open url: http://localhost:${port}`
  )
);

);
