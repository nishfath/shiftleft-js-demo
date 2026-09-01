const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const session = require('express-session');

const { logger } = require('./Logger');
const registerApiRoutes = require('./api');
const registerViewRoutes = require('./views');

const app = express();
const port = process.env.PORT || 8088;

// Use environment variable for session secret, without hardcoded fallback
const SESSION_SECRET_KEY = process.env.SESSION_SECRET_KEY;

if (!SESSION_SECRET_KEY) {
  logger.error('SESSION_SECRET_KEY environment variable must be set');
  process.exit(1);
}

const tarpitEnv = {
  sessionSecretKey: SESSION_SECRET_KEY,
  applicationPort: port
};

app.set('tarpitEnv', tarpitEnv);

// Removed the insider attack middleware that uses eval()
// This was a critical security vulnerability allowing arbitrary code execution

// Error handling middleware
app.use(function(err, req, res, next) {
  logger.error(err.stack);
  // Don't expose internal error details to client
  res.status(500).json({ error: 'Internal server error' });
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
    cookie: {
      httpOnly: true,        // Prevents client-side JavaScript from accessing the cookie
      secure: process.env.NODE_ENV === 'production',  // Ensures cookie is only sent over HTTPS in production
      maxAge: 3600000,       // Cookie expires after 1 hour (in milliseconds)
      sameSite: 'strict'     // Prevents CSRF attacks by restricting cross-site cookie sending
    },
    name: 'sessionId'        // Custom session cookie name (avoids default 'connect.sid')
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
