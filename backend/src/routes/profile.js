const express = require('express');
const { authRequired } = require('../auth');

const router = express.Router();

// GET /api/profile - zwraca profil z tokenu.
router.get('/profile', authRequired, (req, res) => {
  res.json({
    sub: req.user.sub,
    name: req.user.name,
    email: req.user.email,
    preferred_username: req.user.preferred_username,
    roles: req.user.roles,
    scope: req.user.scope,
  });
});

module.exports = router;
