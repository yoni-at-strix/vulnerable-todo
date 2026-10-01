import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import express from "express";
import ejs from "ejs";

import { shareRouter } from "../src/routes/share.js";

const SHARE_VIEW = fileURLToPath(new URL("../views/share.ejs", import.meta.url));

function renderShare(options: { host?: string; requestTarget?: string } = {}) {
  const requestTarget = options.requestTarget ?? "/share";
  const app = express();
  app.use(express.raw());
  app.use("/share", shareRouter);

  return new Promise<{ status: number; body: string; port: number }>((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("could not obtain the listening port"));
        return;
      }
      const request = http.request(
        {
          host: "127.0.0.1",
          port: address.port,
          path: requestTarget,
          headers: options.host === undefined ? {} : { host: options.host },
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            body += chunk;
          });
          response.on("end", () => {
            server.close(() =>
              resolve({ status: response.statusCode ?? 0, body, port: address.port }),
            );
          });
        },
      );
      request.on("error", reject);
      request.end();
    });
  });
}

function sendRawRequest(port: number, requestLine: string, hostHeader: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.end(
        `${requestLine} HTTP/1.1\r\nHost: ${hostHeader}\r\nConnection: close\r\n\r\n`,
      );
    });
    let body = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      body += chunk;
    });
    socket.on("error", reject);
    socket.on("end", () => resolve(body));
  });
}

test("share view renders the QR share URL safely", async () => {
  const html = await ejs.renderFile(SHARE_VIEW, {
    todos: [],
    shareUrl: "http://127.0.0.1:3000/share?title=Groceries",
  });

  assert.match(html, /value: "http:\/\/127\.0\.0\.1:3000\/share\?title=Groceries", size: 140/);
});

test("share view escapes a markup payload in the share URL", async () => {
  const html = await ejs.renderFile(SHARE_VIEW, {
    todos: [],
    shareUrl: 'http://x</script><script>window.__xssProbe=1337;</script>/share',
  });

  assert.doesNotMatch(html, /<\/script><script>/);
  assert.match(
    html,
    /value: "http:\/\/x\\u003c\/script>\\u003cscript>window\.__xssProbe=1337;\\u003c\/script>\/share", size: 140/,
  );
});

test("share route does not allow a Host header payload to break out of the script", async () => {
  const response = await renderShare({ host: "x</script><script>window.__xssProbe=1337;</script>" });

  assert.equal(response.status, 200);
  assert.doesNotMatch(response.body, /<\/script><script>/);
  const inlineScript = response.body.match(/value: "(.*)", size: 140/);
  assert.ok(inlineScript, "the QR value line was found in the response");
  assert.equal(
    inlineScript[1],
    "http://x%3C/script%3E%3Cscript%3Ewindow.__xssProbe=1337;%3C/script%3E/share",
  );
});

test("share route keeps a normal share link readable", async () => {
  const response = await renderShare({
    requestTarget: "/share?title=Groceries&theme=dark",
  });

  assert.equal(response.status, 200);
  const inlineScript = response.body.match(/value: "(.*)", size: 140/);
  assert.ok(inlineScript, "the QR value line was found in the response");
  assert.equal(
    inlineScript[1],
    `http://127.0.0.1:${response.port}/share?title=Groceries&theme=dark`,
  );
});

test("share route does not allow a raw script payload in the request target", async () => {
  const app = express();
  app.use("/share", shareRouter);
  const httpServer = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => (httpServer as net.Server).once("listening", resolve));
  const httpPort = (httpServer.address() as net.AddressInfo).port;

  const payload = "/share?x=</script><script>window.__xssProbe=1337;</script>";
  const body = await sendRawRequest(httpPort, `GET ${payload}`, `127.0.0.1:${httpPort}`);
  httpServer.close();

  assert.doesNotMatch(body, /value: ".*<\/script><script>.*", size: 140/);
  const inlineScript = body.match(/value: "(.*)", size: 140/);
  assert.ok(inlineScript, "the QR value line was found in the response");
  assert.equal(
    inlineScript[1],
    `http://127.0.0.1:${httpPort}/share?x=%3C/script%3E%3Cscript%3Ewindow.__xssProbe=1337;%3C/script%3E`,
  );
});