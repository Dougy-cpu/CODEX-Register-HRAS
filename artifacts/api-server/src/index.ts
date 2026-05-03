import app from "./app";
import { logger } from "./lib/logger";
import { seed, runMigrations } from "./lib/seed";
import { checkSchemaConsistency } from "./lib/schema-check";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  await runMigrations();

  const schemaOk = await checkSchemaConsistency();
  if (!schemaOk) {
    logger.error(
      "Aborting: database schema is out of date. Run 'pnpm --filter @workspace/db run push' then redeploy.",
    );
    process.exit(1);
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    seed().catch((seedErr) => logger.error({ err: seedErr }, "Seed failed"));
  });
}

start().catch((err) => {
  logger.error({ err }, "Startup failed");
  process.exit(1);
});
