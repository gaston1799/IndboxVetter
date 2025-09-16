// authMiddleware.js
exports.requireAuth = (req, res, next) => {
  const user = req.session && req.session.user;
  if (!user) return res.status(401).send('Unauthorized');
  next();
};
