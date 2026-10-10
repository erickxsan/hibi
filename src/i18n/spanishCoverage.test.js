import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { translateToSpanish } from "./translations.js";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const neutralCopy = new Set(["hibi", "Hibi", "Individual", "No", "h", "h ·", "P", "A", "HIBI1-…", "P / (P + A)"]);
const templateSamples = {
  "Save {p0} future {p1}": "Save 2 future classes",
  "{p0} {p1} today": "2 classes today",
  "Average grade {p0}": "Average grade this week",
};

function visitSources(visit) {
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!["test", "i18n"].includes(entry.name)) walk(filename);
      } else if (/\.(js|jsx)$/.test(filename) && !filename.includes(".test.")) {
        const source = ts.createSourceFile(
          filename,
          fs.readFileSync(filename, "utf8"),
          ts.ScriptTarget.Latest,
          true,
          filename.endsWith("jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.JS,
        );
        function walkNode(node) {
          visit(node, source, filename);
          ts.forEachChild(node, walkNode);
        }
        walkNode(source);
      }
    }
  }
  walk(sourceRoot);
}

describe("Spanish coverage of application sources", () => {
  it("localizes status and category labels while retaining canonical option values", () => {
    const missing = [];
    visitSources((node, source, filename) => {
      if (!ts.isJsxExpression(node) || !node.expression || !ts.isJsxElement(node.parent)) return;
      const expression = node.expression.getText(source);
      if (
        /^(status|category|method|ATTENDANCE_LABELS\[.+\]|(?:row|item|session|calculated)\.(?:status|statusLabel|paymentStatus))(?: \|\| "—")?$/.test(
          expression,
        )
      ) {
        missing.push(`${path.relative(sourceRoot, filename)}: ${expression}`);
      }
      const opening = node.parent.openingElement;
      if (
        opening.tagName.getText(source) === "option" &&
        expression.startsWith("uiT(") &&
        !opening.attributes.properties.some((attribute) => attribute.name?.text === "value")
      ) {
        missing.push(`${path.relative(sourceRoot, filename)}: translated option needs a stable value`);
      }
    });
    expect(missing).toEqual([]);
  });
  it("covers every explicit literal UI translation, including accessible labels", () => {
    const missing = [];
    visitSources((node, source, filename) => {
      if (!ts.isCallExpression(node) || !/^(uiT|t)$/.test(node.expression.getText(source))) return;
      const argument = node.arguments[0];
      if (!argument || !ts.isStringLiteral(argument)) return;
      const key = argument.text.trim();
      if (!/[A-Za-z]/.test(key) || neutralCopy.has(key)) return;
      const sample = templateSamples[key] || key.replace(/\{\w+\}/g, "2");
      if (translateToSpanish(key) === key && translateToSpanish(sample) === sample) {
        missing.push(`${path.relative(sourceRoot, filename)}: ${key}`);
      }
    });
    expect(missing).toEqual([]);
  });

  it("covers application-owned diagnostic sentences that can reach notifications", () => {
    const missing = new Set();
    visitSources((node, source, filename) => {
      if (filename.endsWith("seed.js") || !ts.isStringLiteral(node)) return;
      const copy = node.text.trim();
      if (/^[A-Z][a-z].*\s.*[.?…]$/.test(copy) && !/[{}<>]/.test(copy) && translateToSpanish(copy) === copy) {
        missing.add(`${path.relative(sourceRoot, filename)}: ${copy}`);
      }
    });
    expect([...missing]).toEqual([]);
  });
});
