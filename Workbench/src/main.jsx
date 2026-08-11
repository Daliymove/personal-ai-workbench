import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource/noto-sans-sc/chinese-simplified-400.css";
import "@fontsource/noto-sans-sc/chinese-simplified-500.css";
import "@fontsource/noto-sans-sc/chinese-simplified-600.css";
import "@fontsource/noto-serif-sc/chinese-simplified-600.css";
import "@fontsource/noto-serif-sc/chinese-simplified-700.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import { applyStoredTheme } from "./lib/theme.js";
import { App } from "./App.jsx";
import "./styles.css";

// 在首次渲染前应用已保存的主题，避免默认紫色闪现。
applyStoredTheme();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
