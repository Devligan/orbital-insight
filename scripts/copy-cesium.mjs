import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Copies the CesiumJS static runtime assets (workers, widget CSS, default
 * assets) into public/cesium, where window.CESIUM_BASE_URL points. The build
 * remains reproducible from the lockfile - no manual download step.
 */
const source = path.resolve(import.meta.dirname, "../node_modules/cesium/Build/Cesium");
const target = path.resolve(import.meta.dirname, "../public/cesium");

if (!existsSync(source)) {
  console.error("Cesium build assets not found at", source, "— install dependencies first.");
  process.exit(1);
}

mkdirSync(target, { recursive: true });
for (const dir of ["Assets", "Workers", "Widgets", "ThirdParty"]) {
  cpSync(path.join(source, dir), path.join(target, dir), { recursive: true });
}
console.log("Cesium assets copied to public/cesium");
