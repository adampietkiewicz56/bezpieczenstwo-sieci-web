const bodyParser = require('body-parser');
const Account = require('./account');

const noCache = (_req, res, next) => {
  res.set('Pragma', 'no-cache');
  res.set('Cache-Control', 'no-store');
  next();
};

const urlencoded = bodyParser.urlencoded({ extended: false });

function registerInteractionRoutes(app, provider) {
  // GET /interaction/:uid - render odpowiedniej strony (login lub consent).
  app.get('/interaction/:uid', noCache, async (req, res, next) => {
    try {
      const details = await provider.interactionDetails(req, res);
      const { uid, prompt, params, session } = details;
      const client = await provider.Client.find(params.client_id);

      if (prompt.name === 'login') {
        return res.render('login', {
          uid,
          client,
          params,
          flash: req.query.error,
          title: 'Logowanie - bezpsw OIDC',
        });
      }

      if (prompt.name === 'consent') {
        return res.render('consent', {
          uid,
          client,
          params,
          prompt,
          session,
          title: 'Zgoda - bezpsw OIDC',
        });
      }

      return res.render('error', {
        title: 'Nieznana interakcja',
        message: `Nieobslugiwany prompt: ${prompt.name}`,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /interaction/:uid/login - obsluga formularza loginu.
  app.post('/interaction/:uid/login', noCache, urlencoded, async (req, res, next) => {
    try {
      const { prompt, uid } = await provider.interactionDetails(req, res);
      if (prompt.name !== 'login') return res.status(400).end();

      const accountId = await Account.authenticate(req.body.login, req.body.password);
      if (!accountId) {
        return res.redirect(`/interaction/${uid}?error=Niepoprawne+dane+logowania`);
      }

      const result = { login: { accountId } };
      return provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
    } catch (err) {
      next(err);
    }
  });

  // POST /interaction/:uid/confirm - akceptacja consentu (skopiowane z oficjalnego przykladu).
  app.post('/interaction/:uid/confirm', noCache, urlencoded, async (req, res, next) => {
    try {
      const interactionDetails = await provider.interactionDetails(req, res);
      const { prompt: { name, details }, params, session: { accountId } } = interactionDetails;
      if (name !== 'consent') return res.status(400).end();

      let { grantId } = interactionDetails;
      let grant;
      if (grantId) {
        grant = await provider.Grant.find(grantId);
      } else {
        grant = new provider.Grant({ accountId, clientId: params.client_id });
      }

      if (details.missingOIDCScope) {
        grant.addOIDCScope(details.missingOIDCScope.join(' '));
      }
      if (details.missingOIDCClaims) {
        grant.addOIDCClaims(details.missingOIDCClaims);
      }
      if (details.missingResourceScopes) {
        for (const [indicator, scopes] of Object.entries(details.missingResourceScopes)) {
          grant.addResourceScope(indicator, scopes.join(' '));
        }
      }

      grantId = await grant.save();

      const consent = {};
      if (!interactionDetails.grantId) {
        consent.grantId = grantId;
      }

      const result = { consent };
      return provider.interactionFinished(req, res, result, { mergeWithLastSubmission: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /interaction/:uid/abort - odrzucenie consentu / przerwanie loginu.
  app.post('/interaction/:uid/abort', noCache, async (req, res, next) => {
    try {
      const result = {
        error: 'access_denied',
        error_description: 'End-User aborted interaction',
      };
      return provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { registerInteractionRoutes };
