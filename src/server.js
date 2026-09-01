const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const session = require('express-session');

const { logger } = require('./Logger');
const registerApiRoutes = require('./api');
const registerViewRoutes = require('./views');

const app = express();
const port = process.env.PORT || 8088;

// Use environment variable for session secret - never hardcode secrets
const SESSION_SECRET_KEY = process.env.SESSION_SECRET_KEY;

// Validate that SESSION_SECRET_KEY is set
if (!SESSION_SECRET_KEY) {
  logger.error('SESSION_SECRET_KEY environment variable must be set');
  process.exit(1);
}

const tarpitEnv = {
  sessionSecretKey: SESSION_SECRET_KEY,
  applicationPort: process.env.PORT || 8088
};

app.set('tarpitEnv', tarpitEnv);

// REMOVED: Insider attack middleware - this was a critical security vulnerability
// The eval() function executes arbitrary code and should never be used with any input

// Global error handler - placed after routes
app.use(function(err, req, res, next) {
  logger.error(err.stack);
  // Don't expose internal error details to client
  res.status(500).json({ error: 'An internal error occurred' });
});

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// parse application/json
app.use(bodyParser.json());

app.use(cookieParser());

// Configure session with secure cookie settings
app.use(
  session({
    secret: SESSION_SECRET_KEY,
    resave: false,
    saveUninitialized: false,
    name: 'sessionId',
    cookie: {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600000
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
