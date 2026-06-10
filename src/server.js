const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');

const { logger } = require('./Logger');
const registerApiRoutes = require('./api');
const registerViewRoutes = require('./views');

const app = express();
const port = process.env.PORT || 8088;

// Use environment variable for session secret - no hardcoded default
if (!process.env.SESSION_SECRET_KEY) {
  logger.error('SESSION_SECRET_KEY environment variable is not set. Application cannot start.');
  process.exit(1);
}

const tarpitEnv = {
  sessionSecretKey: process.env.SESSION_SECRET_KEY,
  applicationPort: process.env.PORT || 8088
};

app.set('tarpitEnv', tarpitEnv);

// Removed insider attack middleware - this is a critical security vulnerability
// The eval() function executing base64-decoded code is extremely dangerous

// Error handling middleware
app.use(function(err, req, res, next) {
  logger.error(err.stack);
  // Don't expose internal error details to client
  res.status(500).json({ error: 'Internal server error' });
});

// Set request size limits to prevent DoS attacks and resource exhaustion
// parse application/x-www-form-urlencoded with strict limits
app.use(express.urlencoded({ 
  extended: false,
  limit: '100kb',
  parameterLimit: 100
}));

// parse application/json with strict limits
app.use(express.json({ 
  limit: '100kb'
}));

app.use(cookieParser());

// Configure session with secure settings
app.use(
  session({
    secret: process.env.SESSION_SECRET_KEY,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production', // Require HTTPS in production
      httpOnly: true, // Prevent XSS attacks
      maxAge: 1000 * 60 * 60 * 24, // 24 hours
      sameSite: 'strict' // CSRF protection
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
