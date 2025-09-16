// middleware/errorHandler.js

function errorHandler(err, req, res, next) {
  console.error("Error:", err.stack || err.message);

  res.status(err.status || 500).json({
    ok: false,
    error: err.message || "Server error",
  });
}

module.exports = errorHandler;
