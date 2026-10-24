import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseNpmInventory, InventoryError } from "../lib/inventory";

describe("npm Inventory Parser", () => {
  it("parses lockfileVersion 2 and 3 with direct, nested, scoped, dev, and optional entries", () => {
    const pkgJson = JSON.stringify({
      dependencies: {
        express: "^4.19.2",
        "@types/node": "^20.0.0",
      },
      devDependencies: {
        typescript: "^5.0.0",
      },
    });

    const lockJson = JSON.stringify({
      name: "test-app",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "test-app",
          dependencies: { express: "^4.19.2" },
        },
        "node_modules/express": {
          version: "4.19.2",
        },
        "node_modules/@types/node": {
          version: "20.11.0",
          dev: true,
        },
        "node_modules/typescript": {
          version: "5.4.5",
          dev: true,
        },
        "node_modules/express/node_modules/qs": {
          version: "6.11.0",
        },
        "node_modules/optional-dep": {
          version: "1.0.0",
          optional: true,
        },
      },
    });

    const result = parseNpmInventory(pkgJson, lockJson);

    assert.equal(result.entries.length, 5);
    assert.equal(result.coverage.inventoryEntryCount, 5);
    assert.equal(result.coverage.excludedEntries, 0);

    const express = result.entries.find((e) => e.packageName === "express");
    assert.ok(express);
    assert.equal(express.version, "4.19.2");
    assert.equal(express.direct, true);
    assert.deepEqual(express.categories, ["production"]);

    const typesNode = result.entries.find((e) => e.packageName === "@types/node");
    assert.ok(typesNode);
    assert.equal(typesNode.version, "20.11.0");
    assert.equal(typesNode.direct, true);
    assert.deepEqual(typesNode.categories, ["development"]);

    const qs = result.entries.find((e) => e.packageName === "qs");
    assert.ok(qs);
    assert.equal(qs.direct, false);
    assert.deepEqual(qs.paths, ["node_modules/express/node_modules/qs"]);

    const opt = result.entries.find((e) => e.packageName === "optional-dep");
    assert.ok(opt);
    assert.deepEqual(opt.categories, ["optional"]);
  });

  it("deduplicates same package/version at multiple paths into one query and keeps different versions separate", () => {
    const pkgJson = JSON.stringify({ dependencies: {} });
    const lockJson = JSON.stringify({
      name: "multi-path",
      lockfileVersion: 2,
      packages: {
        "": {},
        "node_modules/dep-a/node_modules/shared": {
          version: "1.0.0",
        },
        "node_modules/dep-b/node_modules/shared": {
          version: "1.0.0",
        },
        "node_modules/dep-c/node_modules/shared": {
          version: "2.0.0",
        },
      },
    });

    const result = parseNpmInventory(pkgJson, lockJson);
    assert.equal(result.uniqueQueryablePairs.length, 2);

    const v1 = result.entries.find((e) => e.packageName === "shared" && e.version === "1.0.0");
    assert.ok(v1);
    assert.equal(v1.paths.length, 2);

    const v2 = result.entries.find((e) => e.packageName === "shared" && e.version === "2.0.0");
    assert.ok(v2);
    assert.equal(v2.paths.length, 1);
  });

  it("handles workspace/link, git dependencies, invalid semver, and exclusions", () => {
    const pkgJson = JSON.stringify({});
    const lockJson = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": {},
        "node_modules/symlinked": {
          link: true,
          version: "1.0.0",
        },
        "node_modules/git-pkg": {
          version: "git+https://github.com/foo/bar.git#abc1234",
        },
        "node_modules/bad-semver": {
          version: "not-a-version",
        },
        "node_modules/valid-pkg": {
          version: "1.2.3",
        },
      },
    });

    const result = parseNpmInventory(pkgJson, lockJson);
    assert.equal(result.entries.length, 1);
    assert.equal(result.coverage.excludedEntries, 3);
    assert.equal(result.coverage.exclusions.length, 3);
  });

  it("rejects unsupported lockfile versions and empty inventory", () => {
    const pkgJson = JSON.stringify({});
    const v1Lock = JSON.stringify({ lockfileVersion: 1 });
    assert.throws(() => parseNpmInventory(pkgJson, v1Lock), (err: unknown) => {
      return (err as InventoryError).code === "UNSUPPORTED_LOCKFILE_VERSION";
    });

    const emptyLock = JSON.stringify({ lockfileVersion: 3, packages: { "": {} } });
    assert.throws(() => parseNpmInventory(pkgJson, emptyLock), (err: unknown) => {
      return (err as InventoryError).code === "EMPTY_INVENTORY";
    });
  });

  it("never substitutes package.json version ranges for installed lockfile versions", () => {
    const pkgJson = JSON.stringify({
      dependencies: {
        lodash: "^4.0.0",
      },
    });
    const lockJson = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": {},
        "node_modules/lodash": {
          version: "4.17.21",
        },
      },
    });

    const result = parseNpmInventory(pkgJson, lockJson);
    const lodash = result.entries.find((e) => e.packageName === "lodash");
    assert.ok(lodash);
    assert.equal(lodash.version, "4.17.21");
    assert.notEqual(lodash.version, "^4.0.0");
  });

  it("does not classify hoisted transitive dependencies as direct", () => {
    // Only express is declared directly in package.json
    const pkgJson = JSON.stringify({
      dependencies: {
        express: "^4.19.2",
      },
    });

    // In lockfile, accepts is hoisted to top-level node_modules/accepts as a transitive dependency
    const lockJson = JSON.stringify({
      name: "hoisted-test",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "hoisted-test",
          dependencies: { express: "^4.19.2" },
        },
        "node_modules/express": {
          version: "4.19.2",
        },
        "node_modules/accepts": {
          version: "1.3.8",
        },
      },
    });

    const result = parseNpmInventory(pkgJson, lockJson);
    const express = result.entries.find((e) => e.packageName === "express");
    const accepts = result.entries.find((e) => e.packageName === "accepts");

    assert.ok(express);
    assert.equal(express.direct, true, "Directly declared express must have direct === true");

    assert.ok(accepts);
    assert.equal(
      accepts.direct,
      false,
      "Hoisted transitive dependency accepts must NOT be classified as direct"
    );
  });

  it("does not mark every version of a directly declared package as direct", () => {
    // package.json directly declares lodash v4
    const pkgJson = JSON.stringify({
      dependencies: {
        lodash: "^4.17.21",
      },
    });

    // In lockfile, root resolved instance is node_modules/lodash (4.17.21)
    // while a nested transitive dependency pulls in legacy lodash (3.10.1)
    const lockJson = JSON.stringify({
      name: "multi-version-test",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "multi-version-test",
          dependencies: { lodash: "^4.17.21" },
        },
        "node_modules/lodash": {
          version: "4.17.21",
        },
        "node_modules/some-tool": {
          version: "1.0.0",
        },
        "node_modules/some-tool/node_modules/lodash": {
          version: "3.10.1",
        },
      },
    });

    const result = parseNpmInventory(pkgJson, lockJson);
    const lodashV4 = result.entries.find(
      (e) => e.packageName === "lodash" && e.version === "4.17.21"
    );
    const lodashV3 = result.entries.find(
      (e) => e.packageName === "lodash" && e.version === "3.10.1"
    );

    assert.ok(lodashV4, "Direct lodash v4 must be in inventory");
    assert.equal(
      lodashV4.direct,
      true,
      "Resolved instance node_modules/lodash for root manifest must be direct === true"
    );

    assert.ok(lodashV3, "Nested lodash v3 must be in inventory");
    assert.equal(
      lodashV3.direct,
      false,
      "Nested transitive version node_modules/some-tool/node_modules/lodash must have direct === false"
    );
  });
});
