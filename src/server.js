const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const session = require('express-session');
const helmet = require('helmet');

const { logger } = require('./Logger');
const registerApiRoutes = require('./api');
const registerViewRoutes = require('./views');

const app = express();
const port = process.env.PORT || 8088;

// Validate and use environment variable for session secret
if (!process.env.SESSION_SECRET_KEY) {
  logger.error('SESSION_SECRET_KEY environment variable is not set. Application will not start.');
  process.exit(1);
}

const tarpitEnv = {
  sessionSecretKey: process.env.SESSION_SECRET_KEY,
  applicationPort: process.env.PORT || 8088
};

app.set('tarpitEnv', tarpitEnv);

// Security headers configuration using helmet
app.use(helmet());

// Disable X-Powered-By header to prevent information disclosure
app.disable('x-powered-by');

// Error handling middleware - should be registered early but after helmet
app.use(function(err, req, res, next) {
  logger.error(err.stack);
  // Avoid exposing internal error details to client
  res.status(500).json({ error: 'Internal server error' });
});

// Rate limiting and input validation should be added here
// parse application/x-www-form-urlencoded with size limits
app.use(bodyParser.urlencoded({ 
  extended: false,
  limit: '10kb'
}));

// parse application/json with size limits
app.use(bodyParser.json({
  limit: '10kb'
}));

app.use(cookieParser());

// Session configuration with secure settings
app.use(
  session({
    secret: process.env.SESSION_SECRET_KEY,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600000
    },
    name: 'sessionId'
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
