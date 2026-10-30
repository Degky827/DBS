const router = require("express").Router();
const swaggerUi = require("swagger-ui-express");

const ROUTES = require("../../constants/routes");
const apiDocsAccess = require("../../middlewares/apiDocsAccess");
const apiDocsSecurity = require("../../middlewares/apiDocsSecurity");
const spec = require("../../../docs/openapi.json");

// In production documentation is disabled by default and, when explicitly
// enabled, requires HTTP Basic credentials. The relaxed Swagger CSP applies
// only to these routes, never to application endpoints.
router.get(
  ROUTES.OPENAPI,
  apiDocsAccess,
  apiDocsSecurity,
  (req, res) => {
    return res.json(spec);
  }
);

router.use(
  ROUTES.DOCS,
  apiDocsAccess,
  apiDocsSecurity,
  swaggerUi.serve,
  swaggerUi.setup(spec, {
    customSiteTitle: "Banking User Service API",
    explorer: false,
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: "list",
      filter: true,
      deepLinking: true,
    },
  })
);

module.exports = router;
