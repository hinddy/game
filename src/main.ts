import "./style.css";
import "./design/tokens.css";
import { createApp } from "./app/create-app";
export const app = createApp();
void app.start().catch((error) => {
  console.error(error);
  const loading = document.querySelector("#loading");
  if (loading) {
    const message = document.createElement("pre");
    message.textContent =
      error instanceof Error ? error.message : String(error);
    loading.replaceChildren("Garage failed to open.", message);
  }
});
if (import.meta.hot) import.meta.hot.dispose(() => app.dispose());
