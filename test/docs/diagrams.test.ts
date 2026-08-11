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
  diagramToken?: string;
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
    sourcePath: "src/sources/scale-exporter/reader.ts",
  },
  {
    diagram: "composition",
    claim: "installed binary は exporter を起動しない",
    kind: "absent",
    sourceToken: "scale-exporter",
    sourcePath: "src/installation/plist.ts",
    diagramForbiddenPattern: /(?:LA|LB|BIN)\s*--?>\s*(?:\|[^|]*\|\s*)?EXP/,
  },
  {
    diagram: "run-path",
    claim: "launchd は installed binary の pipeline --period を起動する",
    kind: "present",
    token: "pipeline",
    diagramToken: "pipeline --period",
    sourcePath: "src/installation/plist.ts",
  },
  {
    diagram: "run-path",
    claim: "installed binary は pipeline サブコマンドを呼ぶ",
    kind: "present",
    token: "pipeline",
    diagramToken: "pipeline --period",
    sourcePath: "src/installation/plist.ts",
  },
  {
    diagram: "run-path",
    claim: "転記失敗または当日行が無いとき pipeline は failed:transfer で終える",
    kind: "present",
    token: "failed:transfer",
    sourcePath: "src/pipeline/pipeline.ts",
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

function validateRunPathExitCodes(diagram: string): string[] {
  const errors: string[] = [];
  for (const [outcome, exitCode] of [
    ["completed:no-data", 0],
    ["completed:transferred", 0],
    ["failed:input-missing", 1],
    ["failed:input-unstable", 1],
    ["failed:input-invalid-or-partial", 1],
    ["failed:transfer", 1],
  ] as const) {
    const outcomePattern = new RegExp(`${outcome}[^\\n]*exit ${exitCode}\\b`);
    if (!outcomePattern.test(diagram)) {
      errors.push(`${outcome} は exit ${exitCode} で終わる必要があります`);
    }
  }
  return errors;
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
      const diagramToken = claim.diagramToken ?? claim.token;
      if (!diagram.includes(diagramToken)) {
        errors.push(`${claim.claim}: diagram に ${diagramToken} がありません`);
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
  const runPath = diagrams.get("run-path");
  if (runPath) {
    errors.push(...validateRunPathExitCodes(runPath));
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

  it("rejects a claim whose token appears only in a source comment", () => {
    expect(
      validateDiagrams(readme, {
        "src/installation/plist.ts": "// pipeline is intentionally comment-only\n",
      }),
    ).toContain("installed binary は pipeline サブコマンドを呼ぶ: source に pipeline がありません");
  });

  it("rejects the implementation mutation from run to pipeline", () => {
    const script = readRepositoryFile("src/installation/plist.ts");
    expect(
      validateDiagrams(readme, {
        "src/installation/plist.ts": script.replace("<string>pipeline</string>", "<string>run</string>"),
      }),
    ).toContain("installed binary は pipeline サブコマンドを呼ぶ: source に pipeline がありません");
  });

  it("rejects a restored exporter invocation", () => {
    const script = readRepositoryFile("src/installation/plist.ts");
    expect(
      validateDiagrams(readme, {
        "src/installation/plist.ts": `${script}\nscale-exporter\n`,
      }),
    ).toContain("installed binary は exporter を起動しない: source に scale-exporter が残っています");
  });

  it("rejects a labeled exporter-start arrow", () => {
    expect(validateDiagrams(readme.replace("LA -->|起動| BIN", "LA -->|起動| EXP\n  LA -->|起動| BIN"))).toContain(
      "installed binary は exporter を起動しない: diagram が exporter 起動の矢印を含みます",
    );
  });

  it("rejects a run-path diagram that claims run instead of pipeline", () => {
    const mutatedReadme = readme.replaceAll("pipeline --period", "run --period");
    expect(mutatedReadme).not.toBe(readme);
    expect(validateDiagrams(mutatedReadme)).toContain(
      "installed binary は pipeline サブコマンドを呼ぶ: diagram に pipeline --period がありません",
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
      token: "pipeline",
      sourcePath: "src/installation/plist.ts",
    };
    expect(validateDiagrams(readme, {}, [...claims, orphan])).toContain(
      "孤立 claim は許可しない: diagram removed-diagram がありません",
    );
  });

  it("documents exit codes for every current pipeline outcome", () => {
    const plist = readRepositoryFile("src/installation/plist.ts");
    const runPath = parseReadmeDiagrams(readme).get("run-path");

    expect(plist).toContain("<string>pipeline</string>");
    expect(runPath).toBeDefined();
    expect(validateRunPathExitCodes(runPath ?? "")).toEqual([]);
    const mutatedReadme = readme.replace("failed:input-missing<br/>exit 1", "failed:input-missing<br/>exit 0");
    expect(mutatedReadme).not.toBe(readme);
    expect(validateDiagrams(mutatedReadme)).toContain("failed:input-missing は exit 1 で終わる必要があります");
  });
});
