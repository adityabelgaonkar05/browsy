import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "playwright";

// Real Chrome APIs, isolated profile, local fixture. No access to the user's session.
const fixture = `<!doctype html><html lang="en"><head><title>Browser tools fixture</title></head><body>
  <h1>Authenticated workspace</h1><p>An issue about authentication and session renewal.</p>
  <label for="message">Message</label><input id="message" value="old text">
  <label for="password">Password</label><input id="password" type="password" value="fixture-secret">
  <label for="notes">Notes</label><textarea id="notes">old notes</textarea>
  <div id="editor" contenteditable="true" aria-label="Rich editor">old draft</div>
  <button id="save" onclick="document.getElementById('result').textContent='Saved: '+document.getElementById('message').value">Save message</button>
  <p id="result" aria-live="polite">Waiting</p>
  <a href="/next">Next page</a><div id="shadow"></div><canvas width="160" height="60"></canvas>
  <script>
    const root = document.getElementById('shadow').attachShadow({mode:'open'});
    root.innerHTML = '<button>Shadow action</button>';
    root.querySelector('button').addEventListener('click', (event) => { event.target.textContent = 'Shadow clicked'; });
    const ctx = document.querySelector('canvas').getContext('2d'); ctx.fillStyle='#bcf48b'; ctx.fillRect(0,0,160,60);
  </script>
</body></html>`;
const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(
    req.url === "/next"
      ? "<!doctype html><title>Next page</title><h1>Navigation complete</h1>"
      : fixture,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), "agent-native-test-"));
const extension = resolve("apps/extension/dist");
let context;
let checks = 0;
function passed(name) {
  checks++;
  console.log(`PASS ${name}`);
}

try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(url);
  assert.deepEqual(pageErrors, [], "Fixture must load without JavaScript errors");
  const second = await context.newPage();
  await second.goto(`${url}/?second`);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 420, height: 1050 });
  await panel.goto(`chrome-extension://${extensionId}/sidebar/index.html`);
  await panel.getByRole("heading", { name: "Agent Native", exact: true }).waitFor();
  passed("unpacked MV3 extension loads and renders React control panel");

  async function request(method, params = {}) {
    return panel.evaluate(
      async ({ method, params }) => {
        return chrome.runtime.sendMessage({
          channel: "browser-tools",
          id: crypto.randomUUID(),
          method,
          params,
        });
      },
      { method, params },
    );
  }
  async function tool(method, params = {}) {
    const response = await request(method, params);
    assert.ok(response, "Runtime response must exist");
    assert.ok(!response.error, JSON.stringify(response.error));
    return response.result;
  }
  const tabs = await tool("browser_list_tabs");
  const tabId = tabs.find((tab) => tab.url === `${url}/`).id;
  assert.ok(tabs.some((tab) => tab.url.includes("?second")));
  assert.ok(tabs.every((tab) => typeof tab.id === "number" && typeof tab.title === "string"));
  passed("lists all currently open tabs with IDs, titles and URLs");

  const snapshot = await tool("browser_snapshot", { tabId });
  assert.match(snapshot.text, /heading "Authenticated workspace"/);
  assert.match(snapshot.text, /textbox "Message"/);
  assert.match(snapshot.text, /button "Save message"/);
  assert.match(snapshot.text, /authentication and session renewal/);
  assert.ok(!snapshot.text.includes("fixture-secret"));
  assert.ok(snapshot.text.length < 4000);
  passed("compact accessible snapshot includes refs and text without password values");
  const ref = (name) => snapshot.elements.find((element) => element.name === name)?.ref;

  const html = await tool("browser_get_html", { tabId });
  assert.match(html.html, /<h1>Authenticated workspace<\/h1>/);
  const limited = await tool("browser_get_html", { tabId, maxLength: 50 });
  assert.equal(limited.html.length, 50);
  assert.equal(limited.truncated, true);
  const selected = await tool("browser_get_html", { tabId, selector: "h1" });
  assert.equal(selected.html, "<h1>Authenticated workspace</h1>");
  assert.equal(
    (await request("browser_get_html", { tabId, selector: ".missing" })).error.code,
    "SELECTOR_NOT_FOUND",
  );
  passed("returns raw HTML, selected HTML and explicit truncation");

  const image = await tool("browser_screenshot", { tabId });
  assert.equal(image.mimeType, "image/png");
  const png = Buffer.from(image.data, "base64");
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.ok(png.length > 1000);
  assert.equal(png.readUInt32BE(16), page.viewportSize().width);
  assert.equal(png.readUInt32BE(20), page.viewportSize().height);
  await writeFile(resolve(tmpdir(), "agent-native-viewport.png"), png);
  passed("captures viewport as directly usable PNG image data");

  await tool("browser_type", {
    tabId,
    ref: ref("Message"),
    text: "Hello Chrome",
    replaceExisting: true,
  });
  assert.equal(await page.locator("#message").inputValue(), "Hello Chrome");
  await tool("browser_type", { tabId, ref: ref("Message"), text: "!", replaceExisting: false });
  assert.equal(await page.locator("#message").inputValue(), "Hello Chrome!");
  await tool("browser_type", { tabId, ref: ref("Notes"), text: "", replaceExisting: true });
  assert.equal(await page.locator("#notes").inputValue(), "");
  await tool("browser_type", {
    tabId,
    ref: ref("Rich editor"),
    text: "New draft",
    replaceExisting: true,
  });
  await tool("browser_type", { tabId, ref: ref("Rich editor"), text: "!", replaceExisting: false });
  assert.equal(await page.locator("#editor").innerText(), "New draft!");
  passed("types into snapshot input refs, including replace and append");

  await tool("browser_click", { tabId, ref: ref("Save message") });
  assert.equal(await page.locator("#result").innerText(), "Saved: Hello Chrome!");
  await tool("browser_click", { tabId, ref: ref("Shadow action") });
  assert.equal(await page.getByRole("button", { name: "Shadow clicked" }).count(), 1);
  passed("clicks snapshot refs using trusted input, including shadow DOM");

  await page.locator("#save").evaluate((element) => element.remove());
  assert.equal(
    (await request("browser_click", { tabId, ref: ref("Save message") })).error.code,
    "STALE_REF",
  );
  await tool("browser_snapshot", { tabId });
  assert.equal(
    (await request("browser_type", { tabId, ref: ref("Message"), text: "stale" })).error.code,
    "STALE_REF",
  );
  const renamedSnapshot = await tool("browser_snapshot", { tabId });
  const renamedRef = renamedSnapshot.elements.find(
    (element) => element.name === "Shadow clicked",
  ).ref;
  await page.getByRole("button", { name: "Shadow clicked" }).evaluate((element) => {
    element.textContent = "Renamed action";
  });
  assert.equal(
    (await request("browser_click", { tabId, ref: renamedRef })).error.code,
    "STALE_REF",
  );
  passed("removed elements and superseded snapshots return STALE_REF");

  await tool("browser_navigate", { tabId, url: `${url}/next` });
  await page.waitForURL(`${url}/next`);
  await page.getByRole("heading", { name: "Navigation complete" }).waitFor();
  const nextSnapshot = await tool("browser_snapshot", { tabId });
  assert.match(nextSnapshot.text, /Navigation complete/);
  assert.equal(
    (await request("browser_click", { tabId, ref: renamedRef })).error.code,
    "STALE_REF",
  );
  passed("navigates the same tab and snapshots the new document");

  assert.equal(
    (await request("browser_navigate", { tabId, url: "javascript:alert(1)" })).error.code,
    "INVALID_PARAMS",
  );
  assert.equal((await request("browser_snapshot", { tabId: -1 })).error.code, "INVALID_PARAMS");
  assert.equal(
    (await request("browser_snapshot", { tabId: 2147483647 })).error.code,
    "TAB_NOT_FOUND",
  );
  const internal = await worker.evaluate(() => chrome.tabs.create({ url: "chrome://newtab/" }));
  assert.equal(
    (await request("browser_snapshot", { tabId: internal.id })).error.code,
    "RESTRICTED_PAGE",
  );
  await tool("browser_navigate", { tabId: internal.id, url: `${url}/next` });
  await worker.evaluate((id) => chrome.tabs.remove(id), internal.id);
  passed("invalid parameters and missing tabs return structured errors");

  await panel.locator("#tab").selectOption(String(tabId));
  await panel.getByRole("button", { name: "≡ Snapshot", exact: true }).click();
  await panel.locator(".result-body pre").filter({ hasText: "Navigation complete" }).waitFor();
  await panel.getByRole("button", { name: "▣ Screenshot", exact: true }).click();
  await panel.getByRole("img", { name: "Captured browser viewport" }).waitFor();
  await panel.screenshot({ path: resolve(tmpdir(), "agent-native-panel.png"), fullPage: true });
  await tool("browser_release", { tabId });
  passed("manual sidebar buttons inspect and screenshot a selected tab");
  console.log(
    `\n${checks} browser checks passed. Screenshot: ${resolve(tmpdir(), "agent-native-viewport.png")}`,
  );
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
