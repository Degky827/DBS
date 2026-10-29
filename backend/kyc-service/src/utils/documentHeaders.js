function setPrivateDocumentHeaders(res) {
  res.set("Cache-Control", "private, no-store");
  res.set("Pragma", "no-cache");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Security-Policy", "default-src 'none'; sandbox");
  res.set("Cross-Origin-Resource-Policy", "same-site");
  res.set("X-Frame-Options", "DENY");
}

module.exports = { setPrivateDocumentHeaders };
