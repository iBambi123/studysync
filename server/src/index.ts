// Entry point: start the StudySync server.
import { createStudySyncServer } from "./app.js";

const PORT = Number(process.env.PORT ?? 3001);
const { httpServer } = createStudySyncServer({
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
});

httpServer.listen(PORT, () => {
  console.log(`StudySync server listening on http://localhost:${PORT}`);
});

// Shut down cleanly when the host (Docker, Render) stops the process.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
