import fs from "node:fs/promises";

const [url, outputPath, widthArg = "1440", heightArg = "1100", portArg = "9223", clickText] =
  process.argv.slice(2);

if (!url || !outputPath) {
  throw new Error("Usage: node capture.mjs <url> <output> [width] [height] [debug-port]");
}

const width = Number(widthArg);
const height = Number(heightArg);
const debugPort = Number(portArg);
const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) =>
  response.json(),
);
const target = targets.find((item) => item.type === "page");

if (!target?.webSocketDebuggerUrl) {
  throw new Error("No Chrome page target is available.");
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const runtimeErrors = [];
let commandId = 0;

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    runtimeErrors.push(message.params.exceptionDetails.text);
  }
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

function command(method, params = {}) {
  const id = ++commandId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

await command("Page.enable");
await command("Runtime.enable");
await command("Network.enable");
await command("Network.setCacheDisabled", { cacheDisabled: true });
await command("Emulation.setDeviceMetricsOverride", {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: width < 640,
  screenWidth: width,
  screenHeight: height,
});
await command("Page.navigate", { url });
await new Promise((resolve) => setTimeout(resolve, 6500));

if (clickText) {
  await command("Runtime.evaluate", {
    expression: `(() => {
      const target = [...document.querySelectorAll("button")].find((button) =>
        button.textContent.trim().includes(${JSON.stringify(clickText)})
      );
      if (!target) throw new Error("Button not found: " + ${JSON.stringify(clickText)});
      target.click();
    })()`,
    awaitPromise: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 1200));
}

const result = await command("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: false,
  fromSurface: true,
});

await fs.writeFile(outputPath, Buffer.from(result.data, "base64"));
socket.close();

if (runtimeErrors.length > 0) {
  console.error(`Runtime exceptions: ${runtimeErrors.join(" | ")}`);
  process.exitCode = 2;
} else {
  console.log(`Captured ${width}x${height}: ${outputPath}`);
}
