const app = require('./src/app');
const env = require('./src/config/env');

const server = app.listen(env.PORT, () => {
  console.log(`KYC service running on http://localhost:${env.PORT}`);
});

module.exports = server;
