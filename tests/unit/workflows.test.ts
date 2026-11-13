/**
 * The delivery pipeline's own config (.github/), checked like code.
 *
 * GitHub rejects an unparseable workflow outright ("Invalid workflow file")
 * and never runs it - which is how the data-refresh job once sat dead: an
 * unquoted "polite: one request…" in a step name is a YAML mapping error.
 * Windows-side gates never read these files, so this test does.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { parseDocument } from "yaml";

const WORKFLOW_DIR = ".github/workflows";
const workflows = readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f));

interface Step {
  name?: string;
  uses?: string;
  run?: string;
}

function load(path: string) {
  const doc = parseDocument(readFileSync(path, "utf8"));
  return { errors: doc.errors.map((e) => e.message), value: doc.toJS() as Record<string, unknown> };
}

describe("GitHub Actions workflows", () => {
  it("exist (the checks below are not vacuous)", () => {
    expect(workflows).toEqual(expect.arrayContaining(["ci.yml", "post-deploy.yml", "refresh-data.yml"]));
  });

  for (const file of workflows) {
    describe(file, () => {
      const { errors, value } = load(`${WORKFLOW_DIR}/${file}`);

      it("parses as YAML", () => {
        expect(errors).toEqual([]);
      });

      it("has a trigger and jobs whose steps each either use an action or run a command", () => {
        expect(value.on).toBeDefined();
        const jobs = value.jobs as Record<string, { "runs-on"?: unknown; steps?: Step[] }>;
        expect(Object.keys(jobs).length).toBeGreaterThan(0);
        for (const [id, job] of Object.entries(jobs)) {
          expect(job["runs-on"], `${id} runs-on`).toBeDefined();
          for (const step of job.steps ?? []) {
            expect(Boolean(step.uses) !== Boolean(step.run), `${id} / ${step.name ?? step.uses}`).toBe(true);
          }
        }
      });

      it("pins every action to a version", () => {
        const jobs = value.jobs as Record<string, { steps?: Step[] }>;
        for (const job of Object.values(jobs)) {
          for (const step of job.steps ?? []) {
            if (step.uses && !step.uses.startsWith("./")) expect(step.uses).toMatch(/@[\w.-]+$/);
          }
        }
      });
    });
  }

  it("Dependabot config parses", () => {
    expect(load(".github/dependabot.yml").errors).toEqual([]);
  });
});
