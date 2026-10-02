import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { PassThrough } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, copyFile, mkdtemp, rm, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const exec = promisify(execFile);
const root = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "an-terminal-"));
const home = join(root, "bridge's home");
const profile = join(root, "profile");
const cli = resolve("packages/cli/dist/index.js");
const extension = resolve("apps/extension/dist");
const modulePath = join(root, "bridge-module.mjs");
await build({
  entryPoints: [resolve("packages/native-bridge/src/index.ts")],
  outfile: modulePath,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
});
await copyFile("packages/native-bridge/src/windows-pipe.cs", join(root, "windows-pipe.cs"));
const {
  BridgeClient,
  startNativeHost,
  FrameDecoder,
  encodeFrame,
  bridgePaths,
  registeredManifest,
  registerManifest,
  unregisterManifest,
  registryKey,
  directoryIsPrivate,
  pipeIsPrivate,
  windowsPowerShellEnvironment,
} = await import(pathToFileURL(modulePath));
const extensionId = JSON.parse(await readFile(resolve("apps/extension/manifest.json"), "utf8")).key;
const { createHash } = await import("node:crypto");
const id = createHash("sha256")
  .update(Buffer.from(extensionId, "base64"))
  .digest("hex")
  .slice(0, 32)
  .replace(/[0-9a-f]/g, (char) => String.fromCharCode(97 + parseInt(char, 16)));
const windows = process.platform === "win32";
const registrationKey = windows ? registryKey("chrome") : undefined;
const previousRegistration = registrationKey
  ? await registeredManifest(registrationKey)
  : undefined;
let checks = 0;
function passed(name) {
  checks++;
  console.log(`PASS ${name}`);
}
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function eventually(work, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    try {
      return await work();
    } catch (error) {
      last = error;
    }
    await sleep(200);
  } while (Date.now() < deadline);
  throw last;
}

let context, server, native, mcp, otherMcp, statusClient;
const input = new PassThrough();
const output = new PassThrough();
try {
  const inheritedEnvironment = {
    PSModulePath: "C:\\Program Files\\PowerShell\\7\\Modules",
    psMODULEpath: "another incompatible module path",
    Path: "C:\\Windows\\System32",
    BROWSY_FIXTURE: "preserved",
  };
  const cleanEnvironment = windowsPowerShellEnvironment(inheritedEnvironment);
  assert.deepEqual(cleanEnvironment, {
    Path: inheritedEnvironment.Path,
    BROWSY_FIXTURE: "preserved",
  });
  assert.equal(inheritedEnvironment.PSModulePath, "C:\\Program Files\\PowerShell\\7\\Modules");
  assert.notEqual(cleanEnvironment, inheritedEnvironment);
  passed(
    "Windows PowerShell child environments exclude inherited module paths without changing the parent",
  );

  const controllerPath = join(root, "controller.mjs");
  await build({
    entryPoints: [resolve("apps/extension/browser-tools/chrome-controller.ts")],
    outfile: controllerPath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
  });
  const listener = { addListener() {} };
  globalThis.chrome = {
    debugger: { onDetach: listener, onEvent: listener },
    tabs: {
      onUpdated: listener,
      onRemoved: listener,
      async get(id) {
        return { id, url: "https://example.com" };
      },
    },
  };
  const { ChromeBrowserController } = await import(pathToFileURL(controllerPath));
  const controller = new ChromeBrowserController();
  const queued = await Promise.allSettled(Array.from({ length: 65 }, () => controller.wait(1, 0)));
  assert.equal(queued.filter((result) => result.status === "fulfilled").length, 64);
  assert.equal(queued.find((result) => result.status === "rejected").reason.code, "BUSY");
  await controller.wait(1, 0);
  delete globalThis.chrome;
  passed("tab operation queues are bounded and recover after rejecting excess work");

  const values = [];
  const fragmented = new FrameDecoder(1024, (value) => values.push(value));
  const frames = Buffer.concat([
    encodeFrame({ id: "a", text: "café 世界" }, 1024),
    encodeFrame({ id: "b" }, 1024),
  ]);
  for (const byte of frames) fragmented.push(Buffer.from([byte]));
  fragmented.finish();
  assert.deepEqual(values, [{ id: "a", text: "café 世界" }, { id: "b" }]);
  assert.throws(() => new FrameDecoder(10, () => {}).push(Buffer.from([255, 255, 255, 255])));
  const partial = new FrameDecoder(1024, () => {});
  partial.push(frames.subarray(0, 5));
  assert.throws(() => partial.finish());
  passed("framing handles fragmented/coalesced UTF-8, oversized and truncated frames");

  native = await startNativeHost({
    home,
    extensionId: id,
    origin: `chrome-extension://${id}/`,
    input,
    output,
    requestTimeout: 150,
  });
  const forwarded = [];
  const fromHost = new FrameDecoder(1024 * 1024 - 1, (request) => {
    if (request.kind === "bridge.ready") return;
    forwarded.push(request.id);
    if (request.params?.never) return;
    const result = request.params?.large ? "x".repeat(2_000_000) : request.params;
    input.write(encodeFrame({ id: request.id, result }, 64 * 1024 * 1024 - 1));
  });
  output.on("data", (chunk) => fromHost.push(chunk));
  input.write(encodeFrame({ kind: "bridge.hello", version: 1, extensionId: id }, 1024));
  const first = new BridgeClient(bridgePaths(home).socket, 1000, 2000);
  const second = new BridgeClient(bridgePaths(home).socket, 1000, 2000);
  try {
    const responses = await Promise.all([
      first.request("browser_list_tabs", { client: 1 }),
      second.request("browser_list_tabs", { client: 2 }),
    ]);
    assert.equal(responses[0].result.client, 1);
    assert.equal(responses[1].result.client, 2);
    assert.notEqual(forwarded[0], forwarded[1]);
    assert.equal(
      (await first.request("browser_screenshot", { large: true })).result.length,
      2_000_000,
    );
    assert.equal((await first.request("browser_click", { never: true })).error.code, "TIMEOUT");
    assert.equal((await first.status()).connected, true);
    if (windows) {
      assert.equal(await directoryIsPrivate(bridgePaths(home).directory), true);
      assert.equal(await pipeIsPrivate(bridgePaths(home).socket), true);
    } else {
      assert.equal((await stat(bridgePaths(home).directory)).mode & 0o777, 0o700);
      assert.equal((await stat(bridgePaths(home).socket)).mode & 0o777, 0o600);
    }
    await assert.rejects(
      startNativeHost({
        home,
        extensionId: id,
        origin: `chrome-extension://${id}/`,
        input: new PassThrough(),
        output: new PassThrough(),
      }),
      /already owns/,
    );
    assert.equal((await first.status()).connected, true);
    passed(
      "bridge routes concurrent clients, large responses, timeout errors and protects socket ownership",
    );

    const invalid = createConnection(bridgePaths(home).socket);
    await new Promise((resolve) => invalid.once("connect", resolve));
    invalid.write(Buffer.from([255, 255, 255, 255]));
    await new Promise((resolve) => invalid.once("close", resolve));
    assert.equal((await second.status()).connected, true);
    const interrupted = assert.rejects(
      first.request("browser_click", { never: true }),
      (error) => error.code === "BRIDGE_DISCONNECTED",
    );
    await sleep(20);
    await native.stop();
    native = undefined;
    await interrupted;
    passed("malformed clients cannot kill the host; interrupted actions fail without replay");
  } finally {
    first.close();
    second.close();
  }
  input.destroy();
  output.destroy();

  const installation = JSON.parse(
    (
      await exec(process.execPath, [
        cli,
        "install",
        "--home",
        home,
        "--manifest-dir",
        join(profile, "NativeMessagingHosts"),
        "--chrome-path",
        chromium.executablePath(),
        "--json",
      ])
    ).stdout,
  );
  assert.equal(installation.installation.extensionId, id);
  const manifest = JSON.parse(await readFile(installation.installation.manifest, "utf8"));
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${id}/`]);
  if (!windows) {
    assert.equal((await stat(manifest.path)).mode & 0o777, 0o700);
    assert.equal((await stat(join(home, "config.json"))).mode & 0o777, 0o600);
  }
  const config = JSON.parse(
    (await exec(process.execPath, [cli, "config", "--home", home, "--json"])).stdout,
  );
  assert.equal(config.command, process.execPath);
  assert.deepEqual(config.args, [cli, "mcp", "--home", home]);
  assert.equal(config.opencode.mcp.agent_native_browser.type, "local");
  passed("installer registers the fixed extension ID and emits usable agent configuration");

  const fixture = `<!doctype html><title>GitHub authentication issue</title><h1>Issue: Renew authentication sessions</h1>
    <p>Private workspace visible through an existing authenticated browser session.</p>
    <form onsubmit="event.preventDefault();document.getElementById('result').textContent='Saved: '+document.getElementById('message').value">
    <label for="message">Message</label><input id="message"><button>Save message</button></form><p id="result">Waiting</p>
    <div style="height:1600px"></div><h2>Below the fold</h2>`;
  server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      req.headers.cookie?.includes("session=fixture")
        ? fixture
        : "<!doctype html><title>Signed out</title><h1>Sign in required</h1>",
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.addCookies([{ name: "session", value: "fixture", url }]);
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  assert.equal(new URL(worker.url()).host, id);
  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole("heading", { name: "Issue: Renew authentication sessions" }).waitFor();
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/sidebar/index.html`);
  statusClient = new BridgeClient(bridgePaths(home).socket, 1000, 2000);
  const initialStatus = await eventually(async () => {
    const status = await statusClient.status();
    assert.equal(status.connected, true);
    return status;
  });
  passed("real Chrome launches and handshakes with the registered native host");

  async function connectMcp(name) {
    const client = new Client({ name, version: "0.1.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, "mcp", "--home", home],
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    await client.connect(transport);
    return { client, transport, stderr: () => stderr };
  }
  mcp = await connectMcp("terminal-integration");
  otherMcp = await connectMcp("second-terminal-agent");
  const tools = await mcp.client.listTools();
  assert.equal(tools.tools.length, 17);
  assert.ok(tools.tools.some((tool) => tool.name === "browser_screenshot"));
  async function call(name, args = {}, client = mcp.client) {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result.content));
    return result;
  }
  const [one, two] = await Promise.all([
    call("browser_list_tabs"),
    call("browser_list_tabs", {}, otherMcp.client),
  ]);
  assert.deepEqual(one.content, two.content);
  const tabs = JSON.parse(one.content[0].text);
  const tabId = tabs.find((tab) => tab.url === `${url}/`).id;
  const snapshot = (await call("browser_snapshot", { tabId })).content[0].text;
  assert.match(snapshot, /Private workspace visible/);
  assert.match(snapshot, /Renew authentication sessions/);
  passed("two terminal MCP agents discover tools and inspect the authenticated Chrome session");

  const messageRef = snapshot.match(/\[ref=([^\]]+)\] textbox "Message"/)[1];
  const buttonRef = snapshot.match(/\[ref=([^\]]+)\] button "Save message"/)[1];
  await call("browser_type", { tabId, ref: messageRef, text: "From terminal" });
  assert.equal(await page.locator("#message").inputValue(), "From terminal");
  await call("browser_press_key", { tabId, key: "Enter" });
  assert.equal(await page.locator("#result").innerText(), "Saved: From terminal");
  await call("browser_click", { tabId, ref: buttonRef });
  await call("browser_scroll", { tabId, direction: "down", amount: 500 });
  assert.equal(await page.evaluate(() => window.scrollY), 500);
  const image = (await call("browser_screenshot", { tabId })).content[0];
  assert.equal(image.type, "image");
  assert.equal(image.mimeType, "image/png");
  assert.equal(Buffer.from(image.data, "base64").subarray(1, 4).toString(), "PNG");
  const html = JSON.parse(
    (await call("browser_get_html", { tabId, selector: "h1" })).content[0].text,
  );
  assert.match(html.html, /Renew authentication/);
  await call("browser_snapshot", { tabId });
  const stale = await mcp.client.callTool({
    name: "browser_click",
    arguments: { tabId, ref: buttonRef },
  });
  assert.equal(stale.isError, true);
  assert.equal(JSON.parse(stale.content[0].text).code, "STALE_REF");
  passed("MCP performs ref actions, keyboard input, scrolling, HTML and multimodal screenshots");

  await call("browser_navigate", { tabId, url: `${url}/next` });
  await page.waitForURL(`${url}/next`);
  await call("browser_back", { tabId });
  await page.waitForURL(`${url}/`);
  await call("browser_forward", { tabId });
  await page.waitForURL(`${url}/next`);
  await call("browser_reload", { tabId });
  await page.waitForLoadState("load");
  await call("browser_wait", { tabId, milliseconds: 50 });
  const opened = JSON.parse((await call("browser_open_tab", { url })).content[0].text);
  await call("browser_focus_tab", { tabId: opened.id });
  await call("browser_close_tab", { tabId: opened.id });
  assert.ok(
    !JSON.parse((await call("browser_list_tabs")).content[0].text).some(
      (tab) => tab.id === opened.id,
    ),
  );
  passed("MCP supports navigation history, reload, wait and opening/focusing/closing tabs");

  const diagnostic = JSON.parse(
    (await exec(process.execPath, [cli, "doctor", "--home", home, "--json"])).stdout,
  );
  assert.equal(diagnostic.ok, true);
  if (!windows) {
    await chmod(bridgePaths(home).socket, 0o666);
    await assert.rejects(
      exec(process.execPath, [cli, "doctor", "--home", home, "--json"]),
      (error) => {
        assert.equal(error.code, 1);
        assert.ok(
          JSON.parse(error.stdout).checks.some(
            (check) => check.name === "Socket permissions" && !check.ok,
          ),
        );
        return true;
      },
    );
    await chmod(bridgePaths(home).socket, 0o600);
  }
  // SIGKILL deliberately leaves stale lock/socket files, testing automatic recovery.
  process.kill(initialStatus.pid, "SIGKILL");
  const recovered = await eventually(async () => {
    const status = await statusClient.status();
    assert.equal(status.connected, true);
    assert.notEqual(status.pid, initialStatus.pid);
    return status;
  });
  assert.ok(recovered.pid > 0);
  await eventually(() => call("browser_list_tabs"));
  assert.equal(mcp.stderr(), "");
  assert.equal(otherMcp.stderr(), "");
  await call("browser_release", { tabId });
  passed("doctor validates the live connection; host crashes reconnect with stale-file recovery");
  if (process.argv.includes("--codex")) {
    const run = exec(
      "codex",
      [
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--json",
        "-C",
        root,
        "-c",
        `mcp_servers.agent_native_browser.command=${JSON.stringify(process.execPath)}`,
        "-c",
        `mcp_servers.agent_native_browser.args=${JSON.stringify([cli, "mcp", "--home", home])}`,
        "-c",
        'mcp_servers.agent_native_browser.enabled_tools=["browser_list_tabs","browser_snapshot"]',
        "-c",
        'mcp_servers.agent_native_browser.default_tools_approval_mode="approve"',
        "Find which of my Chrome tabs contains the GitHub issue about authentication. Use browser_list_tabs and browser_snapshot from agent_native_browser. Report the tab ID and quote the page's main heading. Only inspect; do not modify pages or files.",
      ],
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
    );
    run.child.stdin.end();
    const result = await run;
    assert.match(result.stdout, /browser_list_tabs/);
    assert.match(result.stdout, /browser_snapshot/);
    assert.match(result.stdout, /Renew authentication sessions/);
    passed("Codex CLI autonomously locates and inspects the issue using the new MCP tools");
  }
  const originalManifest = await readFile(installation.installation.manifest, "utf8");
  await writeFile(
    installation.installation.manifest,
    JSON.stringify({ ...manifest, path: join(root, "unrelated-host") }),
  );
  await assert.rejects(
    exec(process.execPath, [cli, "uninstall", "--home", home, "--json"]),
    /belongs to another installation/,
  );
  await writeFile(installation.installation.manifest, originalManifest);
  const removed = JSON.parse(
    (await exec(process.execPath, [cli, "uninstall", "--home", home, "--json"])).stdout,
  );
  assert.equal(removed.removed, true);
  for (const path of [
    installation.installation.manifest,
    bridgePaths(home).config,
    bridgePaths(home).launcher,
  ]) {
    await assert.rejects(stat(path), (error) => error.code === "ENOENT");
  }
  await eventually(async () => {
    await assert.rejects(statusClient.status());
  });
  assert.equal(
    JSON.parse((await exec(process.execPath, [cli, "uninstall", "--home", home, "--json"])).stdout)
      .removed,
    false,
  );
  passed("uninstall removes only owned files, stops the live host and is safe to repeat");
  console.log(`\n${checks} terminal checks passed (actual Chrome Native Messaging + stdio MCP).`);
} finally {
  statusClient?.close();
  await mcp?.client.close();
  await otherMcp?.client.close();
  await context?.close();
  await native?.stop();
  input.destroy();
  output.destroy();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (registrationKey) {
    const current = await registeredManifest(registrationKey);
    if (current && current !== previousRegistration && !current.startsWith(root))
      throw new Error("Native registration changed during tests; refusing to overwrite it.");
    if (previousRegistration) await registerManifest(registrationKey, previousRegistration);
    else if (current) await unregisterManifest(registrationKey);
  }
  await rm(root, { recursive: true, force: true });
}
