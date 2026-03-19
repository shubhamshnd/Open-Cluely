const { startApplication } = require('./main-process/start-application');

startApplication().catch((error) => {
  console.error('Fatal startup failure:', error);
  process.exit(1);
});
