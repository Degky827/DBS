const router = require("express").Router();
const swaggerUi = require("swagger-ui-express");

const ROUTES = require("../../constants/routes");
const spec = require("../../../docs/openapi.json");

router.get(ROUTES.OPENAPI, (req, res) => {
  return res.json(spec);
});

router.use(
  ROUTES.DOCS,
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
