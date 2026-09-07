import path from "node:path";
import { OPENGLANCE_SUPPORTED_PROTOCOLS } from "./deep-link.mjs";

export function registerDesktopProtocols({
  app,
  isolatedUserData = false,
  defaultApp = process.defaultApp,
  argv = process.argv,
  execPath = process.execPath,
}) {
  if (isolatedUserData) return false;
  const results = OPENGLANCE_SUPPORTED_PROTOCOLS.map((protocol) => (
    defaultApp && argv[1]
      ? app.setAsDefaultProtocolClient(protocol, execPath, [path.resolve(argv[1])])
      : app.setAsDefaultProtocolClient(protocol)
  ));
  return results.every(Boolean);
}
