import {collectInputs} from "../lib/prompts.ts";
import {InstallerInputsSchema, type Step} from "../lib/types.ts";

export const collectInputsStep: Step = {
  id: "01-collect-inputs",
  title: "Collect inputs",
  // Idempotent so a resumed run with `--rerun 02-foo` doesn't unnecessarily
  // re-prompt for inputs already in state. To genuinely re-edit inputs,
  // the operator passes `--rerun 01-collect-inputs` explicitly.
  idempotent: true,
  async run({state, log}) {
    // Fast path: if state already has a fully valid input set (resume,
    // pre-seeded state file, etc.), skip prompts. The operator can still
    // edit inputs by passing `--rerun 01-collect-inputs`.
    const preflight = InstallerInputsSchema.safeParse(state.inputs);
    if (preflight.success) {
      state.inputs = preflight.data;
      log.info(`Inputs already valid for project ${state.inputs.projectId}; skipping prompts.`);
      return;
    }
    const merged = await collectInputs(state.inputs);
    state.inputs = InstallerInputsSchema.parse(merged);
    log.success(`Inputs captured for project ${state.inputs.projectId}.`);
  },
};
