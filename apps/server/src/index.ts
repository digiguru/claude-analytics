import { buildApp } from "./app.js";
import { AppState } from "./state.js";

const state = new AppState();
const app = buildApp(state);

const { port } = state.config;
app
  .listen({ port, host: "127.0.0.1" })
  .then(() => app.log.info(`Claude Analytics server on http://127.0.0.1:${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
