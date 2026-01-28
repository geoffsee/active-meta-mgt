import { describe, test, expect } from "vitest";
import { execFile } from "child_process";
import { writeFileSync } from "fs";

function run(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        execFile("bun", ["run", "examples/calibration/main.ts", ...args], (error, stdout, stderr) => {
            resolve({ exitCode: error?.code ?? 0, stdout, stderr });
        });
    });
}

describe("index CLI", () => {
    test("exits with error when no file argument provided", async () => {
        const result = await run([]);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("Usage: calibrate <scenario.yaml>");
    });

    test("exits with error for nonexistent file", async () => {
        const result = await run(["nonexistent.yaml"]);
        expect(result.exitCode).not.toBe(0);
    });

    test("produces output for valid YAML input", async () => {
        const tmpFile = "/tmp/calibrate-test-scenario.yaml";
        writeFileSync(tmpFile, "metaContext:\n  id: cli-test");

        const result = await run([tmpFile]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("---- WORKING MEMORY ----");
        expect(result.stdout).toContain("---- DECISIONS ----");
    });
});
