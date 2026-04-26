import pc from "picocolors";
import type {Step} from "../lib/types.ts";

export const printNextStepsStep: Step = {
  id: "14-print-next-steps",
  title: "Print next steps",
  idempotent: false, // always re-print on resume
  async run({state, log}) {
    const {projectId, superAdminEmail, zone, provisionOpenclaw, provisionApphosting} = state.inputs;
    const apphostingUrl = state.artifacts.apphostingUrl ?? "<not yet created>";
    const vm = state.artifacts.openclawVm;
    const backendId = state.artifacts.apphostingBackendId;
    const sidecarProxy = state.artifacts.sidecarProxyUrl ?? "<deploy functions to populate>";
    const repo = state.artifacts.githubRepoCreated ?? "<no GitHub repo created>";
    const openclawLine = provisionOpenclaw === false || !vm
      ? `${pc.cyan("OpenClaw VM:")}    ${pc.dim("skipped — re-run with `--rerun 09-openclaw-vm` after flipping inputs.provisionOpenclaw=true")}`
      : `${pc.cyan("OpenClaw VM:")}    ${vm.name}@${zone}  external=${vm.externalIp ?? "?"}  internal=${vm.internalIp ?? "?"}`;

    const lines = [
      pc.bold(pc.green("Installer base infra complete.")),
      "",
      `${pc.cyan("Project:")}        ${projectId}`,
      `${pc.cyan("Backend id:")}     ${backendId}`,
      `${pc.cyan("App Hosting:")}    ${apphostingUrl}`,
      openclawLine,
      `${pc.cyan("Sidecar proxy:")}  ${sidecarProxy}`,
      `${pc.cyan("GitHub repo:")}    ${repo}`,
      `${pc.cyan("Super-admin:")}    ${superAdminEmail}`,
      "",
      pc.bold("Next steps:"),
      provisionApphosting === false
        ? `  1. ${pc.bold("App Hosting was skipped")} — to add later, flip \`inputs.provisionApphosting=true\` and:
     bun run installer/cli/create-fork.ts --target ${state.inputs.targetDir} --rerun 13-apphosting-backend`
        : state.artifacts.apphostingUrl
          ? `  1. ${pc.bold("App Hosting backend live")} — every \`git push origin main\` auto-deploys via Cloud Build.`
          : `  1. ${pc.bold("App Hosting backend created")} — first build is provisioning. Re-run --rerun 13-apphosting-backend in 5 min to capture the URL.`,
      "",
      `  2. ${pc.bold("Open the portal")} at the App Hosting URL → /auth → complete BootstrapAdminForm`,
      `     (system/settings.bootstrapped flips to true once the first super-admin signs in).`,
      "",
      `  3. ${pc.bold("Run /admin/install")} to fill in branding, contact, address, hours, logos, colors,`,
      `     and bind the OpenClaw VM (gateway ping + per-integration skill sync).`,
      `     The wizard's "Download fork.config.ts" button emits the canonical config —`,
      `     overwrite \`/fork.config.ts\` and \`git push\` to trigger the next App Hosting deploy.`,
      "",
      `  4. ${pc.bold("Wire integrations")} from /admin/integrations: SignalWire, Google Workspace,`,
      `     Slack, Stripe, EHR (DrChrono / Athena / Elation / etc).`,
      "",
      provisionOpenclaw === false || !vm
        ? `  5. ${pc.bold("OpenClaw was skipped at install time")} — when you're ready to add agents,
     edit \`.installer-state.json\` to set \`inputs.provisionOpenclaw: true\` and re-run:
     bun run installer/cli/create-fork.ts --target ${state.inputs.targetDir} --rerun 09-openclaw-vm
     Then \`--rerun 11-openclaw-tokens\` and \`--rerun 12-deploy-first\` to publish + bind.`
        : `  5. ${pc.bold("First-boot OpenClaw install on the VM")} — the startup script does
     \`npm install -g openclaw && openclaw onboard --non-interactive && bun install -g qmd\`
     automatically. Check progress with:
     gcloud compute ssh openclaw --zone=${zone} --project=${projectId} --command='tail -50 /var/log/openclaw-startup.log'`,
      "",
      pc.dim("State: .installer-state.json (re-run installer to resume any failed step; --rerun STEP_ID to redo)."),
    ];
    for (const l of lines) console.log(l);
    log.success("Done.");
  },
};
