import express from 'express';
const app = express();

// Polyfill promise with bluebird.
import Promise from 'bluebird';
global.Promise = Promise;

if (process.env.NODE_ENV !== 'production') {
  app.use(express.static('../frontend/build'));
}

// ----------------------------------------------------------------------------
// Routes and helpers for the routes
// ----------------------------------------------------------------------------
import route from './helpers/route';

import whoami from './routes/whoami';
import checkRepo from './routes/checkRepo';

import webhook from './routes/webhook';
import webhookOld from './routes/webhookOld';

import linksList from './routes/links/list';
import linksGet from './routes/links/get';
import linksCreate from './routes/links/create';
import linksDelete from './routes/links/delete';
import linksUpdate from './routes/links/update';
import linksEnable from './routes/links/enable';

import {addWebhooksForLink, removeOldWebhooksForLink} from './routes/links/addWebhooksForLink';

// ----------------------------------------------------------------------------
// Database stuff
// ----------------------------------------------------------------------------
import {Schema} from 'jugglingdb';
import userBuilder from 'models/User';
import linkBuilder from 'models/Link';
import repositoryBuilder from 'models/Repository';
// const schema = new Schema('sqlite3', {database: 'db.sqlite3'});
const schema = new Schema('mongodb', {
  url: 'mongodb://backstroke:backstroke@ds017256.mlab.com:17256/backstroke-dev',
});
const User = userBuilder(schema);
const Repository = repositoryBuilder(schema);
const Link = linkBuilder(schema);

if (process.env.MIGRATE) {
  console.log('Migrating schema...');
  schema.automigrate();
  console.log('Done.');
}

// ----------------------------------------------------------------------------
// Passport stuff
// ----------------------------------------------------------------------------
import passport from 'passport';
import session from 'express-session';
import strategy from 'auth/strategy';
import serialize from 'auth/serialize';
app.use(session({
  secret: process.env.SESSION_SECRET,
  // store: mongoStore,
}));
app.use(passport.initialize());
app.use(passport.session());
passport.use(strategy(User));
serialize(User, passport);

import bodyParser from 'body-parser';
import morgan from 'morgan';
app.use(morgan('tiny'));

// Authenticate a user
app.get('/setup/login', passport.authenticate('github', {
  successRedirect: '/',
  failureRedirect: '/setup/failed',
  scope: ["repo", "write:repo_hook", "user:email"],
}));
app.get('/setup/login/public', passport.authenticate('github', {
  successRedirect: '/',
  failureRedirect: '/setup/failed',
  scope: ["public_repo", "write:repo_hook", "user:email"],
}));

// Second leg of the auth
app.get("/auth/github/callback", passport.authenticate("github", {
  failureRedirect: '/setup/failed',
}), (req, res) => {
  res.redirect('/#/links'); // on success
});

app.get('/logout', (req, res) => {
  req.logout();
  res.redirect('/');
});

// A utility function to check if a user is authenticated, and if so, return
// the authenticated user. Otherwise, this function will throw an error
function assertLoggedIn(req, res, next) {
  if (req.isAuthenticated()) {
    next();
  } else {
    res.status(401).send({error: 'Not authenticated.'});
  }
}

// Add a bit of middleware that Injects github clients at `req.github.user` and `req.github.bot`.
import githubInstanceMiddleware from './githubInstanceMiddleware';
app.use(githubInstanceMiddleware);

// identify the currently logged in user
app.get('/api/v1/whoami', whoami);

// get all links
app.get('/api/v1/links', bodyParser.json(), assertLoggedIn, route(linksList, [Link]));

// GET a given link
app.get('/api/v1/links/:id', bodyParser.json(), assertLoggedIn, route(linksGet, [Link]));

// create a new link
app.post('/api/v1/links', bodyParser.json(), assertLoggedIn, route(linksCreate, [Link]));

// delete a link
app.delete('/api/v1/links/:id', assertLoggedIn, route(linksDelete, [Link, removeOldWebhooksForLink]));

// return the branches for a given repo
app.get('/api/v1/repos/:provider/:user/:repo', bodyParser.json(), assertLoggedIn, checkRepo);

// POST link updates
app.post('/api/v1/links/:linkId',
  bodyParser.json(),
  assertLoggedIn,
  route(linksUpdate, [Link, Repository, addWebhooksForLink, removeOldWebhooksForLink])
);

// enable or disable a repository
app.post('/api/v1/link/:linkId/enable', bodyParser.json(), route(linksEnable, [Link]));

// the old webhook route
// This parses the body of the request to get most of its data.
app.post("/", bodyParser.json(), route(webhookOld, [webhook]));

// the new webhook route
// No body parsing, all oauth-based
import webhookHandler from './routes/webhook/handler';
app.all('/_:linkId', route(webhook, [Link, webhookHandler]));

if (require.main === module) {
  const port = process.env.PORT || 8001;
  app.listen(port);
  console.log('Listening on port', port);
}