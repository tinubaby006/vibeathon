import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeAssessment } from "../lib/assessment";
import { DependencyEntry } from "../lib/contracts";
import { OsvLookupResult, OsvAdvisoryDetail } from "../lib/osv";

describe("Assessment Normalization & Rules", () => {
  it("normalizes matching advisories, preserves severity source, and filters withdrawn records", () => {
    const inventory: DependencyEntry[] = [
      {
        ecosystem: "npm",
        packageName: "lodash",
        version: "4.17.20",
        paths: ["node_modules/lodash"],
        direct: true,
        categories: ["production"],
        originStatus: "supported",
      },
    ];

    const advisoryDetail: OsvAdvisoryDetail = {
      id: "GHSA-35jh-r3h4-6jhm",
      summary: "Prototype Pollution in lodash",
      aliases: ["CVE-2021-23337"],
      modified: "2021-02-15T00:00:00Z",
      database_specific: {
        severity: "HIGH",
      },
      affected: [
        {
          package: { ecosystem: "npm", name: "lodash" },
          ranges: [
            {
              type: "SEMVER",
              events: [
                { introduced: "0" },
                { fixed: "4.17.21" },
              ],
            },
          ],
        },
      ],
      references: [
        { type: "ADVISORY", url: "https://nvd.nist.gov/vuln/detail/CVE-2021-23337" },
      ],
    };

    const withdrawnDetail: OsvAdvisoryDetail = {
      id: "GHSA-withdrawn-123",
      withdrawn: "2022-01-01T00:00:00Z",
      summary: "Withdrawn issue",
      affected: [
        {
          package: { ecosystem: "npm", name: "lodash" },
        },
      ],
    };

    const lookup: OsvLookupResult = {
      matches: [
        {
          packageName: "lodash",
          version: "4.17.20",
          advisoryIds: ["GHSA-35jh-r3h4-6jhm", "GHSA-withdrawn-123"],
        },
      ],
      advisories: new Map([
        ["GHSA-35jh-r3h4-6jhm", advisoryDetail],
        ["GHSA-withdrawn-123", withdrawnDetail],
      ]),
      unhydratedAdvisoryIds: [],
      failedQueries: [],
      queriedCount: 1,
    };

    const result = normalizeAssessment(inventory, lookup);

    // Withdrawn should be excluded from active findings
    assert.equal(result.findings.length, 1);
    assert.ok(result.warnings.some((w) => w.includes("withdrawn upstream")));

    const finding = result.findings[0];
    assert.equal(finding.packageName, "lodash");
    assert.equal(finding.version, "4.17.20");
    assert.equal(finding.severity, "high");
    assert.equal(finding.severitySource, "GitHub Advisory Database");
    assert.equal(finding.patchStatus, "fix_listed");
    assert.deepEqual(finding.fixedVersionsListed, ["4.17.21"]);
    assert.ok(finding.sourceIds.includes("CVE-2021-23337"));
  });

  it("merges alias-linked advisories sharing IDs for the same package/version", () => {
    const inventory: DependencyEntry[] = [
      {
        ecosystem: "npm",
        packageName: "axios",
        version: "0.21.0",
        paths: ["node_modules/axios"],
        direct: true,
        categories: ["production"],
        originStatus: "supported",
      },
    ];

    const adv1: OsvAdvisoryDetail = {
      id: "GHSA-cph5-m8f7-6c5x",
      aliases: ["CVE-2020-28168"],
      database_specific: { severity: "MEDIUM" },
      affected: [
        {
          package: { ecosystem: "npm", name: "axios" },
          ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "0.21.1" }] }],
        },
      ],
    };

    const adv2: OsvAdvisoryDetail = {
      id: "CVE-2020-28168",
      aliases: ["GHSA-cph5-m8f7-6c5x"],
      database_specific: { severity: "HIGH" },
      affected: [
        {
          package: { ecosystem: "npm", name: "axios" },
          ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "0.21.1" }] }],
        },
      ],
    };

    const lookup: OsvLookupResult = {
      matches: [
        {
          packageName: "axios",
          version: "0.21.0",
          advisoryIds: ["GHSA-cph5-m8f7-6c5x", "CVE-2020-28168"],
        },
      ],
      advisories: new Map([
        ["GHSA-cph5-m8f7-6c5x", adv1],
        ["CVE-2020-28168", adv2],
      ]),
      unhydratedAdvisoryIds: [],
      failedQueries: [],
      queriedCount: 1,
    };

    const result = normalizeAssessment(inventory, lookup);
    // Should be merged into one finding
    assert.equal(result.findings.length, 1);
    const finding = result.findings[0];
    assert.equal(finding.severity, "high"); // Highest recognized severity preserved
    assert.ok(finding.sourceIds.includes("GHSA-cph5-m8f7-6c5x"));
    assert.ok(finding.sourceIds.includes("CVE-2020-28168"));
  });

  it("extracts fix versions strictly for the matching package, never from another package in advisory", () => {
    const detail: OsvAdvisoryDetail = {
      id: "GHSA-multi-package",
      affected: [
        {
          package: { ecosystem: "npm", name: "unrelated-pkg" },
          ranges: [{ type: "SEMVER", events: [{ fixed: "99.9.9" }] }],
        },
        {
          package: { ecosystem: "npm", name: "target-pkg" },
          ranges: [{ type: "SEMVER", events: [{ fixed: "1.2.3" }, { fixed: "2.0.0" }] }],
        },
      ],
    };

    const inventory: DependencyEntry[] = [
      {
        ecosystem: "npm",
        packageName: "target-pkg",
        version: "1.0.0",
        paths: ["node_modules/target-pkg"],
        direct: true,
        categories: ["production"],
        originStatus: "supported",
      },
    ];

    const lookup: OsvLookupResult = {
      matches: [{ packageName: "target-pkg", version: "1.0.0", advisoryIds: ["GHSA-multi-package"] }],
      advisories: new Map([["GHSA-multi-package", detail]]),
      unhydratedAdvisoryIds: [],
      failedQueries: [],
      queriedCount: 1,
    };

    const result = normalizeAssessment(inventory, lookup);
    assert.equal(result.findings.length, 1);
    const f = result.findings[0];
    assert.deepEqual(f.fixedVersionsListed, ["1.2.3", "2.0.0"]);
    assert.ok(!f.fixedVersionsListed.includes("99.9.9"));
  });

  it("treats missing severity as unknown and does not treat CVSS vector as a numeric score", () => {
    const detail: OsvAdvisoryDetail = {
      id: "GHSA-no-sev",
      severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }],
      affected: [{ package: { ecosystem: "npm", name: "pkg-a" } }],
    };

    const inventory: DependencyEntry[] = [
      {
        ecosystem: "npm",
        packageName: "pkg-a",
        version: "1.0.0",
        paths: ["node_modules/pkg-a"],
        direct: true,
        categories: ["production"],
        originStatus: "supported",
      },
    ];

    const lookup: OsvLookupResult = {
      matches: [{ packageName: "pkg-a", version: "1.0.0", advisoryIds: ["GHSA-no-sev"] }],
      advisories: new Map([["GHSA-no-sev", detail]]),
      unhydratedAdvisoryIds: [],
      failedQueries: [],
      queriedCount: 1,
    };

    const result = normalizeAssessment(inventory, lookup);
    assert.equal(result.findings[0].severity, "unknown");
    assert.equal(result.findings[0].severitySource, "CVSS_V3");
  });
});
