import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { Duplex } from "node:stream";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_RESPONSE_BYTES } from "@agent-native/shared";

const exec = promisify(execFile);
const powershell = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
export const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;
const psArgs = (script: string) => [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-EncodedCommand",
  Buffer.from(`$ErrorActionPreference='Stop'; ${script}`, "utf16le").toString("base64"),
];

export function windowsPowerShellEnvironment(source: NodeJS.ProcessEnv = process.env) {
  // pwsh -> Node -> powershell.exe otherwise inherits incompatible PS7 modules.
  // Windows PowerShell reconstructs its own module path when this is absent.
  return Object.fromEntries(
    Object.entries(source).filter(([name]) => name.toUpperCase() !== "PSMODULEPATH"),
  );
}

export async function protectDirectory(path: string) {
  await exec(
    powershell,
    psArgs(
      `$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetAccessRuleProtection($true,$false); foreach($identity in @($sid,[Security.Principal.SecurityIdentifier]'S-1-5-18')) { $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule) }; Set-Acl -LiteralPath ${psQuote(path)} -AclObject $acl`,
    ),
    { env: windowsPowerShellEnvironment() },
  );
}

export async function directoryIsPrivate(path: string) {
  try {
    const { stdout } = await exec(
      powershell,
      psArgs(
        `$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $acl=Get-Acl -LiteralPath ${psQuote(path)}; $bad=@($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($sid,'S-1-5-18') }); if(-not $acl.AreAccessRulesProtected -or $bad.Count -gt 0) { exit 1 }; 'OK'`,
      ),
      { env: windowsPowerShellEnvironment() },
    );
    return stdout.trim() === "OK";
  } catch {
    return false;
  }
}

export async function pipeIsPrivate(path: string) {
  try {
    const { stdout } = await exec(
      powershell,
      psArgs(
        `$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $pipe=New-Object IO.Pipes.NamedPipeClientStream('.',${psQuote(path.slice("\\\\.\\pipe\\".length))},[IO.Pipes.PipeDirection]::InOut); try { $pipe.Connect(1000); $acl=$pipe.GetAccessControl(); $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])); $bad=@($rules | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -ne $sid }); $deny=@($rules | Where-Object { $_.AccessControlType -eq 'Deny' -and $_.IdentityReference.Value -eq 'S-1-5-2' -and $_.PipeAccessRights -eq [IO.Pipes.PipeAccessRights]::FullControl }); if(-not $acl.AreAccessRulesProtected -or $bad.Count -gt 0 -or $deny.Count -eq 0) { exit 1 }; 'OK' } finally { $pipe.Dispose() }`,
      ),
      { env: windowsPowerShellEnvironment() },
    );
    return stdout.trim() === "OK";
  } catch {
    return false;
  }
}

// Chrome and Chrome for Testing share this Windows registry lookup. Chromium
// also falls back to Chrome's key, but gets its own explicit registration.
export function registryKey(browser: string) {
  return `HKCU\\Software\\${browser === "chromium" ? "Chromium" : "Google\\Chrome"}\\NativeMessagingHosts\\com.agent_native.browser`;
}
export async function registeredManifest(key: string): Promise<string | undefined> {
  if (!key.startsWith("HKCU\\")) throw new Error("Native registration must use HKCU.");
  try {
    // reg.exe renders an unset default value as localized text. Read the value
    // directly so an empty key left by uninstall cannot become a bogus path.
    const { stdout } = await exec(
      powershell,
      psArgs(
        `[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::Registry32); $entry=$null; try { $entry=$base.OpenSubKey(${psQuote(key.slice(5))}); $value=$null; if($entry) { $value=$entry.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }; if($null -eq $value) { 'null' } else { ConvertTo-Json -InputObject $value -Compress } } finally { if($entry) { $entry.Dispose() }; $base.Dispose() }`,
      ),
      { env: windowsPowerShellEnvironment() },
    );
    const value: unknown = JSON.parse(stdout.trim());
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}
export async function registerManifest(key: string, manifest: string) {
  await exec("reg.exe", ["add", key, "/ve", "/t", "REG_SZ", "/d", manifest, "/f", "/reg:32"]);
}
export async function unregisterManifest(key: string) {
  await exec("reg.exe", ["delete", key, "/ve", "/f", "/reg:32"]);
}

export async function windowsPipeServer(path: string, onConnection: (socket: Duplex) => void) {
  // The build embeds this source beside the executable, without runtime deps.
  const source = await readFile(
    fileURLToPath(new URL("./windows-pipe.cs", import.meta.url)),
    "utf8",
  );
  const child = spawn(
    powershell,
    psArgs(
      `Add-Type -TypeDefinition ${psQuote(source)}; [AgentNativePipe]::Run(${psQuote(path.slice("\\\\.\\pipe\\".length))})`,
    ),
    {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: windowsPowerShellEnvironment(),
    },
  );
  const server = new EventEmitter();
  const sockets = new Map<number, Duplex>();
  let buffer = Buffer.alloc(0);
  let stopping = false;
  let diagnostics = "";
  function send(kind: number, id: number, bytes: Buffer = Buffer.alloc(0)) {
    const queuedBytes = bytes.length + Math.max(1, Math.ceil(bytes.length / 65536)) * 9;
    if (
      child.stdin.destroyed ||
      child.stdin.writableEnded ||
      child.stdin.writableLength + queuedBytes > MAX_RESPONSE_BYTES * 2
    )
      throw new Error("Windows relay write buffer exceeds its limit or is closed.");
    for (let offset = 0; offset < bytes.length || offset === 0; offset += 65536) {
      const data = bytes.subarray(offset, offset + 65536);
      const header = Buffer.alloc(9);
      header.writeUInt32LE(data.length + 5);
      header[4] = kind;
      header.writeInt32LE(id, 5);
      child.stdin.write(Buffer.concat([header, data]));
    }
  }
  child.stderr.on("data", (data: Buffer) => {
    diagnostics = (diagnostics + data.toString()).slice(-4000);
  });
  child.stdin.on("error", () => {});
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Windows pipe initialization timed out."));
      child.kill();
    }, 15000);
    function failed(error: Error) {
      clearTimeout(timer);
      reject(error);
    }
    child.on("error", failed);
    child.on("exit", () => {
      clearTimeout(timer);
      const error = new Error(`Windows pipe relay stopped. ${diagnostics}`);
      reject(error);
      for (const socket of sockets.values()) socket.destroy();
      if (!stopping && server.listenerCount("error")) server.emit("error", error);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const size = buffer.readUInt32LE();
        if (size < 5 || size > 65541) {
          failed(new Error("Invalid Windows relay frame."));
          child.kill();
          return;
        }
        if (buffer.length < size + 4) break;
        const kind = buffer[4],
          id = buffer.readInt32LE(5);
        const data = buffer.subarray(9, size + 4);
        buffer = buffer.subarray(size + 4);
        if (kind === 4) {
          clearTimeout(timer);
          resolve();
        } else if (kind === 1) {
          const socket = new Duplex({
            read() {},
            write(chunk: Buffer, _encoding, done) {
              try {
                send(2, id, chunk);
                done();
              } catch (error) {
                done(error instanceof Error ? error : new Error("Windows relay write failed."));
              }
            },
            destroy(error, done) {
              sockets.delete(id);
              try {
                send(3, id);
              } catch {
                // Closing a full relay must not crash the host. Its lifetime
                // follows the Node process even when a close frame cannot fit.
                child.kill();
              }
              done(error);
            },
          });
          sockets.set(id, socket);
          onConnection(socket);
        } else if (kind === 2) sockets.get(id)?.push(data);
        else if (kind === 3) sockets.get(id)?.destroy();
      }
    });
  });
  await ready;
  return Object.assign(server, {
    close(done: () => void) {
      stopping = true;
      if (child.exitCode !== null) done();
      else {
        child.once("exit", done);
        child.stdin.end();
      }
    },
  });
}
