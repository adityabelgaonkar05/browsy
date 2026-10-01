# Troubleshooting

Start with:

```sh
node packages/cli/dist/index.js doctor
```

Use `--json` for structured output. Include `--home` if the installation uses a custom bridge directory.

| Symptom                            | Action                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Host/registration missing          | Build the project and rerun `install`; reload the extension                                            |
| Node or CLI path missing           | Reinstall using the current Node installation and repository location                                  |
| Chrome not detected                | Reinstall with `--chrome-path` pointing to its executable                                              |
| Terminal agents show disconnected  | Keep Chrome open; reload the extension or click Reconnect                                              |
| Extension ID mismatch              | Use the ID from `chrome://extensions` with `install --extension-id`; reload the extension              |
| Another profile owns the bridge    | Close the duplicate profile or use a separate installation/home                                        |
| Stale process lock                 | Reconnect the extension; a dead host's lock is reclaimed automatically                                 |
| Permissions check fails            | Reinstall to restore the private bridge directory permissions; reconnect to recreate the socket        |
| Agent cannot find tools            | Run the printed agent configuration command and start a new agent session                              |
| Snapshot reports `RESTRICTED_PAGE` | Switch from `chrome://extensions`, another internal page, or a file URL to a normal HTTP/HTTPS website |
| Debugger unavailable               | Close DevTools/another debugger for the tab; managed browser policies can also restrict attachment     |
| Ref is stale                       | Take another snapshot and use the new reference                                                        |
| Request disconnects or times out   | Inspect the page before repeating the action; it may already have occurred                             |

Chrome displays a debugger banner while the extension controls a tab. Canceling the banner can detach the debugger. New inspection reconnects, but previous refs have expired.

If an unpacked build's ID changed, remove its old entry from `chrome://extensions` and load the rebuilt `apps/extension/dist`. The current development build has a fixed public key/ID, so ordinary rebuilds preserve its registration.

For bugs, include the Chrome/macOS/Node versions, reproduction steps, tool/error, and redacted doctor output. A minimal local page is more useful than private website data.
