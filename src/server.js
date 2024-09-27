	const express = require('express');
	const cookieParser = require('cookie-parser');
	const bodyParser = require('body-parser');
	const session = require('express-session');

	const { logger } = require('./Logger');
	const registerApiRoutes = require('./api');
	const registerViewRoutes = require('./views');

	const app = express();
	const port = process.env.PORT || 8088;
	// Removed hardcoded secret key

	const tarpitEnv = {
	  sessionSecretKey: process.env.SESSION_SECRET_KEY || 'default-secret-key', // Use default key if no env var is set
	  applicationPort: process.env.PORT || 8088
	};

	app.set('tarpitEnv', tarpitEnv);

	// Removed insider attack middleware

	app.use(function(err, req, res, next) {
	  logger.error(err.stack);
	  res.status(500).send('Something broke!');
	});

	// parse application/x-www-form-urlencoded
	app.use(bodyParser.urlencoded({ extended: false }));

	// parse application/json
	app.use(bodyParser.json());

	app.use(cookieParser());

	app.use(
	  session({
	    secret: tarpitEnv.sessionSecretKey, // Use secret key from environment variable
	    resave: false,
	    saveUninitialized: false
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


