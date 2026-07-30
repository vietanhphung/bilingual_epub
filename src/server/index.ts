import { loadEnv } from "../config/env.js";
import { getDatabase } from "../persistence/database.js";
import { getLogger } from "../logging/logger.js";
import { createServer } from "./app.js";

const env = loadEnv();
const db = getDatabase();
const app = createServer(db, env);

app.listen(env.PORT, () => {
  getLogger().info({ port: env.PORT, webAppOrigin: env.WEB_APP_ORIGIN }, "bilingual-epub API listening");
});
