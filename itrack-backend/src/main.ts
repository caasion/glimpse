import Fastify from "fastify";
import cors from "@fastify/cors";

import { settings } from "./config/settings.js";
import healthRoutes from "./routes/health.js";
import dwellRoutes from "./routes/dwell.js";
import profileRoutes from "./routes/profile.js";
import runtimeRoutes from "./routes/runtime.js";

const app = Fastify({
  bodyLimit: 10 * 1024 * 1024, // 10 MB
  logger: settings.DEBUG
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
            messageFormat: "{msg}",
          },
        },
      }
    : true,
});

await app.register(cors, { origin: "*" });
await app.register(healthRoutes, { prefix: "/health" });
await app.register(dwellRoutes, { prefix: "/dwell" });
await app.register(profileRoutes, { prefix: "/profile" });
await app.register(runtimeRoutes, { prefix: "/runtime" });

try {
  await app.listen({
    host: settings.HOST,
    port: settings.PORT,
  });

  app.log.info(`iTrack backend running - sourcing: ${settings.PRODUCT_SOURCING_MODE}`);
  app.log.info(
    {
      backboard_base_url: settings.BACKBOARD_BASE_URL,
      backboard_api_key_configured: Boolean(settings.BACKBOARD_API_KEY),
      backboard_debug_logging_enabled: settings.DEBUG,
    },
    "Backboard runtime config",
  );
  app.log.info(
    {
      cloudinary_enabled: settings.CLOUDINARY_ENABLED,
      cloudinary_cloud_name_configured: Boolean(settings.CLOUDINARY_CLOUD_NAME),
      cloudinary_upload_preset_configured: Boolean(settings.CLOUDINARY_UPLOAD_PRESET),
      cloudinary_direct_upload_enabled:
        settings.CLOUDINARY_ENABLED &&
        Boolean(settings.CLOUDINARY_CLOUD_NAME) &&
        Boolean(settings.CLOUDINARY_UPLOAD_PRESET),
    },
    "Cloudinary runtime config",
  );
} catch (error) {
  app.log.error(error, "Failed to start server");
  process.exit(1);
}
