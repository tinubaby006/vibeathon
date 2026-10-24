import { createHash } from "node:crypto";
import semver from "semver";
import {
  DependencyEntry,
  DependencyUsageCategory,
  ScanCoverage,
} from "./contracts";

export interface ParsedInventory {
  lockfileHash: string;
  entries: DependencyEntry[];
  coverage: ScanCoverage;
  uniqueQueryablePairs: Array<{ name: string; version: string }>;
}

export class InventoryError extends Error {
  constructor(
    message: string,
    public code:
      | "MALFORMED_LOCKFILE"
      | "UNSUPPORTED_LOCKFILE_VERSION"
      | "INVENTORY_SIZE_EXCEEDED"
      | "EMPTY_INVENTORY"
  ) {
    super(message);
    this.name = "InventoryError";
  }
}

const MAX_QUERYABLE_PAIRS = 1000;
const NPM_PACKAGE_NAME_REGEX = /^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i;

interface RawPackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface RawPackageLock {
  name?: string;
  lockfileVersion?: number;
  packages?: Record<
    string,
    {
      name?: string;
      version?: string;
      dev?: boolean;
      optional?: boolean;
      devOptional?: boolean;
      link?: boolean;
      resolved?: string;
      inBundle?: boolean;
    }
  >;
  dependencies?: Record<string, unknown>;
}

/**
 * Parses package.json and package-lock.json (lockfileVersion 2 or 3) into sanitized,
 * deduplicated queryable entries and explicit exclusions.
 */
export function parseNpmInventory(
  packageJsonRaw: string,
  packageLockRaw: string
): ParsedInventory {
  // 1. Calculate SHA-256 hash of raw lockfile bytes
  const lockfileHash = createHash("sha256").update(packageLockRaw, "utf-8").digest("hex");

  // 2. Parse package.json for direct dependency names
  let manifest: RawPackageJson;
  try {
    manifest = JSON.parse(packageJsonRaw) as RawPackageJson;
  } catch {
    throw new InventoryError("package.json is malformed JSON", "MALFORMED_LOCKFILE");
  }

  const directDepNames = new Set<string>([
    ...Object.keys(manifest.dependencies || {}),
    ...Object.keys(manifest.devDependencies || {}),
    ...Object.keys(manifest.optionalDependencies || {}),
    ...Object.keys(manifest.peerDependencies || {}),
  ]);

  // 3. Parse package-lock.json
  let lock: RawPackageLock;
  try {
    lock = JSON.parse(packageLockRaw) as RawPackageLock;
  } catch {
    throw new InventoryError("package-lock.json is malformed JSON", "MALFORMED_LOCKFILE");
  }

  if (
    typeof lock.lockfileVersion !== "number" ||
    (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3)
  ) {
    throw new InventoryError(
      `Unsupported lockfileVersion: ${lock.lockfileVersion}. Only package-lock.json version 2 and 3 are supported.`,
      "UNSUPPORTED_LOCKFILE_VERSION"
    );
  }

  if (!lock.packages || typeof lock.packages !== "object") {
    throw new InventoryError(
      "package-lock.json is missing the 'packages' map required for lockfileVersion 2 and 3",
      "MALFORMED_LOCKFILE"
    );
  }

  const exclusions: Array<{ name: string; versionSpec: string; reason: string }> = [];
  const warnings: string[] = [];
  let totalEntriesFound = 0;

  // Intermediate map keyed by "packageName@exactVersion"
  const pairMap = new Map<
    string,
    {
      packageName: string;
      version: string;
      paths: Set<string>;
      direct: boolean;
      categories: Set<DependencyUsageCategory>;
    }
  >();

  for (const [pkgPath, pkgInfo] of Object.entries(lock.packages)) {
    // Skip the root empty string entry representing the project itself
    if (pkgPath === "") {
      continue;
    }

    totalEntriesFound++;

    // Check link/workspace/file
    if (pkgInfo.link) {
      exclusions.push({
        name: pkgInfo.name || pkgPath,
        versionSpec: pkgInfo.version || "workspace/link",
        reason: "Workspace or symlinked package (not from npm registry)",
      });
      continue;
    }

    // Derive package name
    let packageName = pkgInfo.name;
    if (!packageName) {
      // Extract from the last node_modules segment
      const lastNmIndex = pkgPath.lastIndexOf("node_modules/");
      if (lastNmIndex !== -1) {
        packageName = pkgPath.slice(lastNmIndex + "node_modules/".length);
      }
    }

    if (!packageName || !NPM_PACKAGE_NAME_REGEX.test(packageName)) {
      exclusions.push({
        name: packageName || pkgPath,
        versionSpec: pkgInfo.version || "unknown",
        reason: "Invalid or ambiguous npm package name",
      });
      continue;
    }

    // Check version
    const rawVersion = pkgInfo.version;
    if (!rawVersion) {
      exclusions.push({
        name: packageName,
        versionSpec: "none",
        reason: "Package entry has no specified version",
      });
      continue;
    }

    // Check if git or file URL
    if (
      rawVersion.startsWith("git+") ||
      rawVersion.startsWith("http://") ||
      rawVersion.startsWith("https://") ||
      rawVersion.startsWith("file:")
    ) {
      exclusions.push({
        name: packageName,
        versionSpec: rawVersion,
        reason: "Non-registry Git/file/URL dependency source",
      });
      continue;
    }

    const cleanedVersion = semver.clean(rawVersion) || semver.valid(rawVersion);
    if (!cleanedVersion) {
      exclusions.push({
        name: packageName,
        versionSpec: rawVersion,
        reason: "Version is not a valid exact semver string",
      });
      continue;
    }

    // Determine category
    let category: DependencyUsageCategory = "production";
    if (pkgInfo.dev) {
      category = "development";
    } else if (pkgInfo.optional) {
      category = "optional";
    }

    const key = `${packageName}@${cleanedVersion}`;
    const isDirect = directDepNames.has(packageName) || pkgPath === `node_modules/${packageName}`;

    let existing = pairMap.get(key);
    if (!existing) {
      existing = {
        packageName,
        version: cleanedVersion,
        paths: new Set<string>(),
        direct: false,
        categories: new Set<DependencyUsageCategory>(),
      };
      pairMap.set(key, existing);
    }

    existing.paths.add(pkgPath);
    if (isDirect) existing.direct = true;
    existing.categories.add(category);
  }

  const uniquePairs = Array.from(pairMap.values()).map((p) => ({
    name: p.packageName,
    version: p.version,
  }));

  if (uniquePairs.length === 0) {
    throw new InventoryError(
      "No valid queryable npm dependencies found in package-lock.json",
      "EMPTY_INVENTORY"
    );
  }

  if (uniquePairs.length > MAX_QUERYABLE_PAIRS) {
    throw new InventoryError(
      `Inventory has ${uniquePairs.length} unique package/version pairs, exceeding the maximum limit of ${MAX_QUERYABLE_PAIRS}`,
      "INVENTORY_SIZE_EXCEEDED"
    );
  }

  const entries: DependencyEntry[] = Array.from(pairMap.values()).map((p) => ({
    ecosystem: "npm",
    packageName: p.packageName,
    version: p.version,
    paths: Array.from(p.paths).sort(),
    direct: p.direct,
    categories: Array.from(p.categories).sort() as DependencyUsageCategory[],
    originStatus: "supported",
  }));

  const coverage: ScanCoverage = {
    inventoryEntryCount: totalEntriesFound,
    uniqueQueryablePairs: uniquePairs.length,
    queriedPairs: 0,
    failedPairs: 0,
    excludedEntries: exclusions.length,
    hydratedAdvisories: 0,
    unhydratedAdvisoryIds: [],
    warnings,
    exclusions,
  };

  return {
    lockfileHash,
    entries,
    coverage,
    uniqueQueryablePairs: uniquePairs,
  };
}
