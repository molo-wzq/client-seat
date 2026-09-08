import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createHttpProductApi } from "./product/http-product-api";
import "./ui/ui.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App api={createHttpProductApi()} />
  </StrictMode>,
);
