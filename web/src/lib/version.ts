import semver from "semver";

import pkg from "../../package.json" with { type: "json" };

/**
 * The API reports its own version so clients can tell which build they are
 * talking to. Only semver.valid() is used here: no range parsing, no
 * satisfies(), no new Range().
 */
export function apiVersion(): { version: string; valid: boolean } {
  const version = pkg.version;
  return { version, valid: semver.valid(version) !== null };
}
