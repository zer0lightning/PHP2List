// SPDX-License-Identifier: MIT
// Builds software.json and timeline.json from a local checkout of the source repository,
// using exactly the same parsing and cleaning code as the site's worker.
// Run by .github/workflows/data.yml, which then writes the files to Workers KV.
//
// Builds software.json, timeline.json and changes.json.
// Set SOURCE_ARCHIVED=true when the source repository has been archived (the Action does this).
// Usage:  node tools/build-data.mjs <checkout-dir> <output-dir> [source]
//   checkout-dir  a git checkout of NCSC-NL/php2shell (README.md and software/ are enough)
//   output-dir    where to write software.json and timeline.json
//   source        optional "owner/repo@branch" label of the checkout (default: the official repo)
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  sourcesFrom, buildListFromFiles, buildTimelineFrom, buildChangesFrom, normaliseList, normaliseTimeline, normaliseChanges,
  _internals,
} from "../public/_worker.js";

const [dirArg, outArg, sourceArg] = process.argv.slice(2);
if (!dirArg || !outArg) { console.error("Usage: node tools/build-data.mjs <checkout-dir> <output-dir> [owner/repo@branch]"); process.exit(2); }
const dir = resolve(dirArg), out = resolve(outArg);
const { LIMITS, LIST_FILES, CHANGELOG_FILE } = _internals();

function read(rel, maxBytes) {
  const path = join(dir, rel);
  if (!path.startsWith(dir + "/")) throw new Error(`refusing to read outside the checkout: ${rel}`);
  const size = statSync(path).size;
  if (size > maxBytes) throw new Error(`${rel} is too large (${size} bytes)`);
  return readFileSync(path, "utf8");
}

const src = sourcesFrom(sourceArg ? { SOURCE_PRIMARY: sourceArg } : {})[0];
let rev = null;
try { rev = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }
if (rev && !/^[0-9a-f]{40}$/.test(rev)) rev = null;

const [readme, ...pages] = LIST_FILES.map((f, i) => read(f, i === 0 ? LIMITS.README_BYTES : LIMITS.PAGE_BYTES));
const now = Date.now();
const list = buildListFromFiles(readme, pages, src, rev, now);
if (String(process.env.SOURCE_ARCHIVED || "").toLowerCase() === "true") list.sourceArchived = true;
const changelog = read(CHANGELOG_FILE, LIMITS.CHANGELOG_BYTES);
const meta = { sourceLabel: src.label, sourceId: src.id, sourceRevision: rev, official: src.official };
const timeline = { ...buildTimelineFrom(changelog, list, now), ...meta };
const changes = { ...buildChangesFrom(changelog, list, now), ...meta };

// The worker must accept exactly what is written; fail the run rather than publish bad data.
if (!normaliseList(list, now)) throw new Error("software.json would be rejected by the worker");
if (!normaliseTimeline(timeline, now)) throw new Error("timeline.json would be rejected by the worker");
if (!normaliseChanges(changes, now)) throw new Error("changes.json would be rejected by the worker");

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "software.json"), JSON.stringify(list));
writeFileSync(join(out, "timeline.json"), JSON.stringify(timeline));
writeFileSync(join(out, "changes.json"), JSON.stringify(changes));
console.log(`Built ${list.count} products from ${src.label}${rev ? ` @ ${rev.slice(0, 12)}` : ""}; list updated: ${list.listUpdated || "unknown"}; ${timeline.points.length} timeline points; ${changes.count} changes in the last ${changes.days} days${list.sourceArchived ? "; source is ARCHIVED" : ""}.`);
