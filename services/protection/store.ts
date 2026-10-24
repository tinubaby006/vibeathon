// services/protection/store.ts
// Isolated persistence for Checkpoint 2 Protection Controller
// Owns data/protection-state.json with serialized atomic updates and validation.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  ControllerState,
  ControllerStateSchema,
  ProtectionProposal,
  TestRun,
  Approval,
  HistoryEntry,
  Rule,
} from "./types";
import { DATA_DIR } from "../../lib/store";

const MAX_HISTORY_ENTRIES = 50;

export function getProtectionStateFilePath(): string {
  if (process.env.VRC_PROTECTION_STATE_FILE_PATH) {
    return path.resolve(process.env.VRC_PROTECTION_STATE_FILE_PATH);
  }
  return path.join(DATA_DIR, "protection-state.json");
}

let writeMutex = Promise.resolve();

function enqueueWrite<T>(op: () => Promise<T> | T): Promise<T> {
  const next = writeMutex.then(() => op());
  writeMutex = next.then(
    () => {},
    () => {}
  );
  return next;
}

export class ProtectionStore {
  private stateFilePath: string;
  private state: ControllerState | null = null;
  private currentInstanceId: string;

  constructor(controllerInstanceId: string, stateFilePath?: string) {
    this.currentInstanceId = controllerInstanceId;
    this.stateFilePath = stateFilePath || getProtectionStateFilePath();
  }

  public init(): ControllerState {
    const dir = path.dirname(this.stateFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.stateFilePath)) {
      const bundledProtectionPath = path.join(process.cwd(), "data", "protection-state.json");
      let initialState: ControllerState | null = null;
      if (this.stateFilePath !== bundledProtectionPath) {
        try {
          if (fs.existsSync(bundledProtectionPath)) {
            const raw = fs.readFileSync(/*turbopackIgnore: true*/ bundledProtectionPath, "utf-8");
            const parsed = JSON.parse(raw);
            if (parsed && parsed.version === 1) {
              initialState = parsed;
            }
          }
        } catch {}
      }

      if (!initialState) {
        initialState = {
          version: 1,
          controllerInstanceId: this.currentInstanceId,
          activeRule: null,
          ruleRevision: 0,
          activatedAt: null,
          relatedApprovalId: null,
          relatedTestRunId: null,
          proposals: [],
          testRuns: [],
          approvals: [],
          history: [
            {
              id: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              type: "controller_started",
              details: { controllerInstanceId: this.currentInstanceId, note: "Initialized fresh state" },
            },
          ],
        };
      }
      this.writeStateSync(initialState);
      this.state = initialState;
      return initialState;
    }

    try {
      const raw = fs.readFileSync(/*turbopackIgnore: true*/ this.stateFilePath, "utf8");
      const parsed = JSON.parse(raw);
      const validated = ControllerStateSchema.parse(parsed);

      // On restart, record new controller instance ID
      validated.controllerInstanceId = this.currentInstanceId;

      this.state = validated;
      this.addHistoryEntrySync({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        type: "controller_started",
        details: {
          controllerInstanceId: this.currentInstanceId,
          restoredActiveRule: validated.activeRule,
          ruleRevision: validated.ruleRevision,
        },
      });

      return this.state;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Corrupt or unreadable protection state file at ${this.stateFilePath}: ${msg}`);
    }
  }

  private writeStateSync(state: ControllerState): void {
    const dir = path.dirname(this.stateFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempPath = `${this.stateFilePath}.${crypto.randomUUID()}.tmp`;
    const data = JSON.stringify(state, null, 2);
    fs.writeFileSync(tempPath, data, "utf8");
    fs.renameSync(tempPath, this.stateFilePath);
    this.state = state;
  }

  public async getState(): Promise<ControllerState> {
    if (!this.state) {
      this.init();
    }
    return this.state!;
  }

  public getStateSync(): ControllerState {
    if (!this.state) {
      this.init();
    }
    return this.state!;
  }

  private addHistoryEntrySync(entry: HistoryEntry): void {
    if (!this.state) return;
    this.state.history.unshift(entry);
    if (this.state.history.length > MAX_HISTORY_ENTRIES) {
      this.state.history = this.state.history.slice(0, MAX_HISTORY_ENTRIES);
    }
    this.writeStateSync(this.state);
  }

  public async addProposal(proposal: ProtectionProposal): Promise<void> {
    return enqueueWrite(async () => {
      const state = await this.getState();
      // Replace existing proposal with same ID if present or append
      const idx = state.proposals.findIndex((p) => p.id === proposal.id);
      if (idx >= 0) {
        state.proposals[idx] = proposal;
      } else {
        state.proposals.unshift(proposal);
      }
      this.addHistoryEntrySync({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        type: "proposal_created",
        details: {
          proposalId: proposal.id,
          proposalHash: proposal.proposalHash,
          ruleKind: proposal.rule.kind,
          path: proposal.rule.path,
        },
      });
    });
  }

  public async addTestRun(testRun: TestRun): Promise<void> {
    return enqueueWrite(async () => {
      const state = await this.getState();
      const idx = state.testRuns.findIndex((t) => t.id === testRun.id);
      if (idx >= 0) {
        state.testRuns[idx] = testRun;
      } else {
        state.testRuns.unshift(testRun);
      }
      this.addHistoryEntrySync({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        type: "test_run",
        details: {
          testRunId: testRun.id,
          proposalId: testRun.proposalId,
          status: testRun.status,
          observationsCount: testRun.observations.length,
        },
      });
    });
  }

  public async addApproval(approval: Approval): Promise<void> {
    return enqueueWrite(async () => {
      const state = await this.getState();
      const idx = state.approvals.findIndex((a) => a.id === approval.id);
      if (idx >= 0) {
        state.approvals[idx] = approval;
      } else {
        state.approvals.unshift(approval);
      }
      this.addHistoryEntrySync({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        type: "approval_granted",
        details: {
          approvalId: approval.id,
          proposalHash: approval.proposalHash,
          testRunId: approval.testRunId,
        },
      });
    });
  }

  public async activateRule(params: {
    rule: Rule;
    approvalId: string;
    testRunId: string;
  }): Promise<{ ruleRevision: number; activatedAt: string }> {
    return enqueueWrite(async () => {
      const state = await this.getState();
      const now = new Date().toISOString();
      state.activeRule = params.rule;
      state.ruleRevision += 1;
      state.activatedAt = now;
      state.relatedApprovalId = params.approvalId;
      state.relatedTestRunId = params.testRunId;

      // Mark approval as consumed
      const app = state.approvals.find((a) => a.id === params.approvalId);
      if (app) {
        app.consumed = true;
      }

      this.addHistoryEntrySync({
        id: crypto.randomUUID(),
        timestamp: now,
        type: "rule_activated",
        details: {
          ruleRevision: state.ruleRevision,
          ruleKind: params.rule.kind,
          path: params.rule.path,
          approvalId: params.approvalId,
          testRunId: params.testRunId,
        },
      });

      return { ruleRevision: state.ruleRevision, activatedAt: now };
    });
  }

  public async rollbackRule(params: { reason?: string }): Promise<{ ruleRevision: number }> {
    return enqueueWrite(async () => {
      const state = await this.getState();
      const now = new Date().toISOString();
      const previousRule = state.activeRule;
      state.activeRule = null;
      state.ruleRevision += 1;
      state.activatedAt = null;
      state.relatedApprovalId = null;
      state.relatedTestRunId = null;

      this.addHistoryEntrySync({
        id: crypto.randomUUID(),
        timestamp: now,
        type: "rule_rolled_back",
        details: {
          previousRule,
          ruleRevision: state.ruleRevision,
          reason: params.reason || "Developer requested containment rollback",
        },
      });

      return { ruleRevision: state.ruleRevision };
    });
  }

  public getProposalSync(id: string): ProtectionProposal | null {
    const state = this.getStateSync();
    return state.proposals.find((p) => p.id === id) || null;
  }

  public getTestRunSync(id: string): TestRun | null {
    const state = this.getStateSync();
    return state.testRuns.find((t) => t.id === id) || null;
  }

  public getApprovalSync(id: string): Approval | null {
    const state = this.getStateSync();
    return state.approvals.find((a) => a.id === id) || null;
  }

  public getHistorySync(limit: number = 20): HistoryEntry[] {
    const state = this.getStateSync();
    return state.history.slice(0, limit);
  }
}
