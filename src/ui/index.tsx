import React from "react";
import { createRoot } from "react-dom/client";
import { SandboxProxy } from "../shared/DocumentSandboxApi";
import { guarded } from "./timeout";
import App from "./components/App";

import addOnUISdk, { AppEvent, RuntimeType } from "https://new.express.adobe.com/static/add-on-sdk/sdk.js";

// Express tells us which theme it is in and fires themechange when the user switches.
// The panel is styled from data-theme on the root element rather than from React state,
// so a theme change is a repaint and never a re-render.
const applyTheme = (theme: string) =>
    document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");

addOnUISdk.ready.then(async () => {
    const { runtime } = addOnUISdk.instance;

    applyTheme(addOnUISdk.app.ui.theme);
    addOnUISdk.app.on(AppEvent.themechange, ({ theme }) => applyTheme(theme));
    // Proxy to the functions exposed by src/sandbox/code.ts
    const sandboxProxy: SandboxProxy = guarded(await runtime.apiProxy(RuntimeType.documentSandbox));

    const root = createRoot(document.getElementById("root"));
    root.render(<App addOnUISdk={addOnUISdk} sandboxProxy={sandboxProxy} />);
});
