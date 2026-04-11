import { createApp } from "./app.js";

const bootstrap = async () => {
  const { app } = await createApp();
  const port = Number(process.env.PORT || 4000);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`ownwa server listening on http://localhost:${port}`);
  });
};

void bootstrap();
