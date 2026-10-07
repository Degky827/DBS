const router = require("express").Router();
const swaggerUi = require("swagger-ui-express");

const ROUTES = require("../../constants/routes");
const spec = require("../../../docs/openapi.json");

router.get(ROUTES.OPENAPI, (req, res) => {
  return res.json(spec);
});

router.get(ROUTES.OPENAPI_YAML, (req, res) => {
  return res.type("text/yaml").sendFile(require("path").join(__dirname, "../../../docs/openapi.yaml"));
});

router.use(
  ROUTES.DOCS,
  swaggerUi.serve,
  swaggerUi.setup(spec, {
    customSiteTitle: "Banking Auth Service API",
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
