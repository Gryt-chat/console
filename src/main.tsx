import { GrytProvider } from "@gryt/ui";
import "@gryt/ui/styles.css";
import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GrytProvider>
      <App />
    </GrytProvider>
  </StrictMode>,
);
