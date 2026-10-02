import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { listPlatformCapabilities } from "./platformCapabilities.mjs";

const source = await fs.readFile(path.join(process.cwd(), "server", "studioPublishing.mjs"), "utf8");
const platforms = listPlatformCapabilities().map(item => item.platform);
for (const platform of platforms) {
  const branch = source.includes("case " + JSON.stringify(platform) + ":");
  assert.equal(branch, true, "Publisher branch missing for " + platform);
}
assert.equal(source.includes("Unsupported publishing platform"), true);
console.log("Publisher adapter dispatch contract passed for " + platforms.length + " platforms.");
