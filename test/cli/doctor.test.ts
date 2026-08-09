import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerInstallationCommands,
  type DoctorCliDeps,
  type InstallationCommandDeps,
} from "../../src/cli/installation.js";
import type { DoctorDeps, DoctorReport } from "../../src/installation/doctor.js";
import { formatInstallCommand } from "../../src/installation/paths.js";

afterEach(() => {
  process.exitCode = undefined;
});

function doctorCliDeps(report: DoctorReport): DoctorCliDeps {
  return {
    createDoctorDeps: () => ({} as DoctorDeps),
    runDoctor: vi.fn(async () => report),
    logger: { log: vi.fn(), error: vi.fn() },
  };
}

function commandDeps(doctor: DoctorCliDeps): InstallationCommandDeps {
  return {
    doctor,
    runInstallCommand: vi.fn(async () => 0),
    runUninstallCommand: vi.fn(async () => 0),
  };
}

describe("CLI: doctor", () => {
  it("keeps the recovery command registered: the displayed install subcommand accepts --launchd", () => {
    const program = new Command();
    registerInstallationCommands(program, commandDeps(doctorCliDeps({ status: "PASS", checks: [] })));

    const displayed = formatInstallCommand("/Users/example/.local", true);
    const commandName = displayed.match(/^scale2sheet ([^ ]+) --prefix /)?.[1];
    const command = program.commands.find((candidate) => candidate.name() === commandName);

    expect(commandName).toBeDefined();
    expect(command?.options.some((option) => option.long === "--launchd")).toBe(true);
  });

  it("runs doctor explicitly, prints every check, and exits zero without a FAIL", async () => {
    const deps = doctorCliDeps({
      status: "WARN",
      checks: [
        { id: "manifest", status: "WARN", message: "not installed" },
        { id: "last-run", status: "PASS", message: "legacy route" },
      ],
    });
    const program = new Command();
    registerInstallationCommands(program, commandDeps(deps));

    await program.parseAsync(["node", "scale2sheet", "doctor"]);

    expect(deps.runDoctor).toHaveBeenCalledWith(expect.anything());
    expect(deps.logger.log).toHaveBeenCalledWith("[WARN] manifest: not installed");
    expect(deps.logger.log).toHaveBeenCalledWith("[PASS] last-run: legacy route");
    expect(process.exitCode).toBe(0);
  });

  it("returns non-zero only when doctor reports a FAIL", async () => {
    const deps = doctorCliDeps({
      status: "FAIL",
      checks: [{ id: "sheets-auth", status: "FAIL", stage: "AUTH_FAILED", message: "invalid_grant" }],
    });
    const program = new Command();
    registerInstallationCommands(program, commandDeps(deps));

    await program.parseAsync(["node", "scale2sheet", "doctor"]);

    expect(deps.logger.error).toHaveBeenCalledWith("[FAIL] sheets-auth (AUTH_FAILED): invalid_grant");
    expect(process.exitCode).toBe(1);
  });

  it("does not invoke doctor from install or uninstall", async () => {
    const doctor = {
      ...doctorCliDeps({ status: "PASS", checks: [] }),
      // Creating these deps wires the production Google Sheets adapter.  The
      // install/uninstall boundary must not reach it, even under network deny.
      createDoctorDeps: vi.fn(() => ({} as DoctorDeps)),
    };
    const deps = commandDeps(doctor);

    const installProgram = new Command();
    registerInstallationCommands(installProgram, deps);
    await installProgram.parseAsync(["node", "scale2sheet", "install", "--dry-run"]);

    const uninstallProgram = new Command();
    registerInstallationCommands(uninstallProgram, deps);
    await uninstallProgram.parseAsync(["node", "scale2sheet", "uninstall", "--dry-run"]);

    expect(deps.runInstallCommand).toHaveBeenCalledOnce();
    expect(deps.runUninstallCommand).toHaveBeenCalledOnce();
    expect(doctor.createDoctorDeps).not.toHaveBeenCalled();
    expect(doctor.runDoctor).not.toHaveBeenCalled();
  });
});
