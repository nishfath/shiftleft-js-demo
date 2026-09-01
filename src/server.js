const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const session = require('express-session');

const { logger } = require('./Logger');
const registerApiRoutes = require('./api');
const registerViewRoutes = require('./views');

const app = express();
const port = process.env.PORT || 8088;

// Use environment variable for session secret, fail if not provided in production
const SESSION_SECRET_KEY = process.env.SESSION_SECRET_KEY;
if (!SESSION_SECRET_KEY && process.env.NODE_ENV === 'production') {
  throw new Error('SESSION_SECRET_KEY must be set in production environment');
}

const tarpitEnv = {
  sessionSecretKey: SESSION_SECRET_KEY || 'default-dev-key-change-in-production',
  applicationPort: process.env.PORT || 8088
};

app.set('tarpitEnv', tarpitEnv);

// REMOVED: Insider attack middleware - this is a critical security vulnerability
// The eval() function executing arbitrary code has been completely removed

// Error handling middleware
app.use(function(err, req, res, next) {
  logger.error(err.stack);
  // Don't expose internal error details in production
  if (process.env.NODE_ENV === 'production') {
    res.status(500).send('Internal Server Error');
  } else {
    res.status(500).send('Something broke!');
  }
});

// Parse application/x-www-form-urlencoded with size limit
app.use(bodyParser.urlencoded({ extended: false, limit: '10mb' }));

// Parse application/json with size limit
app.use(bodyParser.json({ limit: '10mb' }));

// Cookie parser with httpOnly enabled by default
app.use(cookieParser());

// Determine if running in production (HTTPS available)
const isProduction = process.env.NODE_ENV === 'production';

// Session configuration with secure cookie settings
app.use(
  session({
    secret: SESSION_SECRET_KEY || 'default-dev-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    name: 'sessionId', // Rename cookie to avoid default name
    cookie: {
      secure: isProduction, // Set to true in production (requires HTTPS)
      httpOnly: true, // Prevent client-side JavaScript access to cookies
      sameSite: 'strict', // Restrict cookie to same-site requests
      maxAge: 1000 * 60 * 60 * 24, // 24 hours session expiration
      path: '/', // Cookie available for entire site
      domain: process.env.COOKIE_DOMAIN || undefined // Set domain if needed
    }
  })
);

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.set('view engine', 'pug');
app.set('views', `./src/Views`);

registerApiRoutes(app);
registerViewRoutes(app);

app.listen(port, () =>
  logger.log(
    `Tarpit App listening on port ${port}!. Open url: http${isProduction ? 's' : ''}://localhost:${port}`
  )
);

);

);

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

);
