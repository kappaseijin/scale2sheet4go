import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = new URL("../..", import.meta.url).pathname;
const readRepositoryFile = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8");

/*
 * Scope: these claims cover the README's execution topology and its outcomes
 * that are easy to silently change (entrypoint, exporter ownership, command,
 * exit behavior, and not-written handling). They do not claim to verify every
 * presentation detail: launchd's four schedule times, data-arrow direction,
 * and notification wording are review-visible text, not semantic claims.
 */

type PresentClaim = {
  diagram: string;
  claim: string;
  kind: "present";
  token: string;
  sourcePath: string;
};

type AbsentClaim = {
  diagram: string;
  claim: string;
  kind: "absent";
  sourceToken: string;
  sourcePath: string;
  diagramForbiddenPattern: RegExp;
};

type Claim = PresentClaim | AbsentClaim;

const claims: readonly Claim[] = [
  {
    diagram: "composition",
    claim: "scale_exporter の公開ファイルを入力として確認する",
    kind: "present",
    token: "scale_exporter_",
    sourcePath: "scripts/run-pipeline.sh",
  },
  {
    diagram: "composition",
    claim: "run-pipeline.sh は exporter を起動しない",
    kind: "absent",
    sourceToken: '"$exporter"',
    sourcePath: "scripts/run-pipeline.sh",
    diagramForbiddenPattern: /SH\s*--?>\s*(?:\|[^|]*\|\s*)?EXP/,
  },
  {
    diagram: "run-path",
    claim: "launchd は run-pipeline.sh を起動する",
    kind: "present",
    token: "run-pipeline.sh",
    sourcePath: "scripts/launchd/jp.seijin.kappa.scale-pipeline.morning.plist",
  },
  {
    diagram: "run-path",
    claim: "run-pipeline.sh は run サブコマンドを呼ぶ",
    kind: "present",
    token: "run --period",
    sourcePath: "scripts/run-pipeline.sh",
  },
  {
    diagram: "run-path",
    claim: "当日行が無いとき run は not-written で終える",
    kind: "present",
    token: "not-written",
    sourcePath: "src/sheets/adapter.ts",
  },
];

function stripComments(path: string, content: string): string {
  if (path.endsWith(".sh")) {
    return content.replace(/^\s*#.*$/gm, "");
  }
  if (path.endsWith(".ts")) {
    return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }
  return content;
}

function parseReadmeDiagrams(readme: string): Map<string, string> {
  const diagrams = new Map<string, string>();
  const markerAndFence = /<!-- diagram: ([a-z0-9-]+) -->\s*\n```mermaid\n([\s\S]*?)\n```/g;
  for (const match of readme.matchAll(markerAndFence)) {
    diagrams.set(match[1], match[2]);
  }
  return diagrams;
}

function validateDiagrams(
  readme: string,
  sourceContents: Record<string, string> = {},
  allClaims: readonly Claim[] = claims,
): string[] {
  const diagrams = parseReadmeDiagrams(readme);
  const errors: string[] = [];
  const mermaidFenceCount = [...readme.matchAll(/```mermaid\n/g)].length;

  if (diagrams.size !== mermaidFenceCount) {
    errors.push("README の全 mermaid フェンスには diagram marker が必要です");
  }

  for (const diagram of diagrams.keys()) {
    if (!allClaims.some((claim) => claim.diagram === diagram)) {
      errors.push(`diagram ${diagram} に claim がありません`);
    }
    if (!diagrams.get(diagram)?.includes(`%% verify: ${diagram}`)) {
      errors.push(`diagram ${diagram} に verify: ${diagram} がありません`);
    }
  }
  for (const claim of allClaims) {
    const diagram = diagrams.get(claim.diagram);
    if (!diagram) {
      errors.push(`${claim.claim}: diagram ${claim.diagram} がありません`);
      continue;
    }

    const source = stripComments(
      claim.sourcePath,
      sourceContents[claim.sourcePath] ?? readRepositoryFile(claim.sourcePath),
    );
    if (claim.kind === "present") {
      if (!source.includes(claim.token)) {
        errors.push(`${claim.claim}: source に ${claim.token} がありません`);
      }
      if (!diagram.includes(claim.token)) {
        errors.push(`${claim.claim}: diagram に ${claim.token} がありません`);
      }
    } else {
      if (source.includes(claim.sourceToken)) {
        errors.push(`${claim.claim}: source に ${claim.sourceToken} が残っています`);
      }
      if (claim.diagramForbiddenPattern.test(diagram)) {
        errors.push(`${claim.claim}: diagram が exporter 起動の矢印を含みます`);
      }
    }
  }
  return errors;
}

describe("README diagrams (#157)", () => {
  const readme = readRepositoryFile("README.md");

  it("documents every Mermaid diagram with matching implementation claims", () => {
    expect(validateDiagrams(readme)).toEqual([]);
  });

  it("rejects an unmarked Mermaid fence", () => {
    const unmarkedDiagram = `${readme}\n\`\`\`mermaid\nflowchart TD\n\`\`\`\n`;
    expect(validateDiagrams(unmarkedDiagram)).toContain(
      "README の全 mermaid フェンスには diagram marker が必要です",
    );
  });

  it("rejects a claim whose token appears only in a shell comment", () => {
    expect(
      validateDiagrams(readme, {
        "scripts/run-pipeline.sh": "# run --period is intentionally comment-only\n",
      }),
    ).toContain("run-pipeline.sh は run サブコマンドを呼ぶ: source に run --period がありません");
  });

  it("rejects the implementation mutation from run to pipeline", () => {
    const script = readRepositoryFile("scripts/run-pipeline.sh");
    expect(
      validateDiagrams(readme, {
        "scripts/run-pipeline.sh": script.replace('"$scale2sheet_bin" run --period', '"$scale2sheet_bin" pipeline --period'),
      }),
    ).toContain("run-pipeline.sh は run サブコマンドを呼ぶ: source に run --period がありません");
  });

  it("rejects a restored exporter invocation", () => {
    const script = readRepositoryFile("scripts/run-pipeline.sh");
    expect(
      validateDiagrams(readme, {
        "scripts/run-pipeline.sh": `${script}\n"$exporter" --source google-fit\n`,
      }),
    ).toContain('run-pipeline.sh は exporter を起動しない: source に "$exporter" が残っています');
  });

  it("rejects a labeled exporter-start arrow", () => {
    expect(validateDiagrams(readme.replace("SH -->|起動| BIN", "SH -->|起動| EXP\n  SH -->|起動| BIN"))).toContain(
      "run-pipeline.sh は exporter を起動しない: diagram が exporter 起動の矢印を含みます",
    );
  });

  it("rejects a run-path diagram that claims pipeline instead of run", () => {
    expect(validateDiagrams(readme.replace("scale2sheet run --period P", "scale2sheet pipeline --period P"))).toContain(
      "run-pipeline.sh は run サブコマンドを呼ぶ: diagram に run --period がありません",
    );
  });

  it("rejects a composition diagram without the scale_exporter input node", () => {
    expect(validateDiagrams(readme.replaceAll("scale_exporter", "exporter"))).toContain(
      "scale_exporter の公開ファイルを入力として確認する: diagram に scale_exporter_ がありません",
    );
  });

  it("rejects an orphan claim", () => {
    const orphan: PresentClaim = {
      diagram: "removed-diagram",
      claim: "孤立 claim は許可しない",
      kind: "present",
      token: "run --period",
      sourcePath: "scripts/run-pipeline.sh",
    };
    expect(validateDiagrams(readme, {}, [...claims, orphan])).toContain(
      "孤立 claim は許可しない: diagram removed-diagram がありません",
    );
  });

  it("documents that the wrapper maps every run failure to exit 1", () => {
    const script = readRepositoryFile("scripts/run-pipeline.sh");
    const runPath = parseReadmeDiagrams(readme).get("run-path");

    expect(script).toContain('if ! "$scale2sheet_bin" run --period "$period"; then');
    expect(script).toContain("exit 1");
    expect(runPath).toContain("exit 1");
    expect(runPath).not.toContain("exit 2");
    expect(runPath).toMatch(/RN\s*--?>\s*\w+\(\["exit 1"\]\)/);
  });
});
