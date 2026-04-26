import type {Step} from "../lib/types.ts";
import {collectInputsStep} from "./01-collect-inputs.ts";
import {copyTemplateStep} from "./02-copy-template.ts";
import {gitInitStep} from "./03-git-init.ts";
import {gcpProjectStep} from "./04-gcp-project.ts";
import {enableApisStep} from "./05-enable-apis.ts";
import {firebaseInitStep} from "./06-firebase-init.ts";
import {secretsStep} from "./07-secrets.ts";
import {iamStep} from "./08-iam.ts";
import {auditRetentionStep} from "./08b-audit-retention.ts";
import {openclawVmStep} from "./09-openclaw-vm.ts";
import {forkConfigStep} from "./10-fork-config.ts";
import {openclawTokensStep} from "./11-openclaw-tokens.ts";
import {deployFirstStep} from "./12-deploy-first.ts";
import {packageSourceStep} from "./12b-package-source.ts";
import {sourceRefreshTriggerStep} from "./12c-source-refresh-trigger.ts";
import {apphostingBackendStep} from "./13-apphosting-backend.ts";
import {printNextStepsStep} from "./14-print-next-steps.ts";

/**
 * Ordered list. The runner walks them in order, skipping any whose `id` is
 * already in `state.completedSteps` AND whose `idempotent` flag is true.
 */
export const STEPS: readonly Step[] = [
  collectInputsStep,
  copyTemplateStep,
  gitInitStep,
  gcpProjectStep,
  enableApisStep,
  firebaseInitStep,
  secretsStep,
  iamStep,
  auditRetentionStep,
  openclawVmStep,
  forkConfigStep,
  openclawTokensStep,
  deployFirstStep,
  packageSourceStep,
  sourceRefreshTriggerStep,
  apphostingBackendStep,
  printNextStepsStep,
];
