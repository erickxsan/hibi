import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { SPANISH_TRANSLATIONS, translateToSpanish } from "./translations.js";
import "./screenTranslations.js";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const neutralCopy = new Set([
  "hibi",
  "Hibi",
  "Individual",
  "individual",
  "App",
  "No",
  "h",
  "h ·",
  "P",
  "A",
  "HIBI1-…",
  "P / (P + A)",
  "Tutor · {phone}",
  "{value} pp vs. {previous}",
  "{value} vs. {previous}",
  "{value}% vs. {previous}",
  "{title}, {range}, {state}",
]);
const templateSamples = {
  "Save {p0} future {p1}": "Save 2 future classes",
  "{p0} {p1} today": "2 classes today",
  "Average grade {p0}": "Average grade this week",
};
// Words that read the same in Spanish; anything else left in English means a partial translation.
const neutralWords = new Set(["Hibi", "HIBI", "hibi"]);
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

/** Literal keys of a t()/uiT() argument, including both branches of `t(count === 1 ? "a" : "b")`. */
function literalKeys(node) {
  if (!node) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isParenthesizedExpression(node)) return literalKeys(node.expression);
  if (ts.isConditionalExpression(node)) return [...literalKeys(node.whenTrue), ...literalKeys(node.whenFalse)];
  return [];
}

function visitTranslationKeys(visit) {
  visitSources((node, source, filename) => {
    if (!ts.isCallExpression(node) || !/^(uiT|t)$/.test(node.expression.getText(source))) return;
    for (const raw of literalKeys(node.arguments[0])) {
      const key = raw.trim();
      if (/[A-Za-z]/.test(key) && !neutralCopy.has(key))
        visit(key, path.relative(sourceRoot, filename).split(path.sep).join("/"));
    }
  });
}

/** English words of the key (placeholders and context markers aside) still present in its translation. */
function untranslatedWords(key, translated) {
  const words =
    key
      .replace(/\{\w+\}/g, " ")
      .replace(/ \((?:plural|fee|count|class|debt|sum|short)\)\s*$/, "")
      .match(/[A-Za-z]{3,}/g) || [];
  return words.filter(
    (word) => !neutralWords.has(word) && new RegExp(`(^|[^A-Za-z])${word}($|[^A-Za-z])`).test(translated),
  );
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
    visitTranslationKeys((key, file) => {
      if (Object.hasOwn(SPANISH_TRANSLATIONS, key)) return;
      const sample = templateSamples[key] || key.replace(/\{\w+\}/g, "2");
      const translated = translateToSpanish(sample);
      // A broad regex rule (e.g. «(.+) pending» → «… pendiente») used to count as coverage while it left
      // the rest of the sentence in English: «octubre monthly fee pendiente».
      if (translateToSpanish(key) === key && translated === sample) missing.push(`${file}: ${key}`);
      else if (untranslatedWords(key, translated).length)
        missing.push(`${file}: ${key} → ${translated} (partial translation)`);
    });
    expect(missing).toEqual([]);
  });

  it("gives every feature key with placeholders its own Spanish entry", () => {
    // t() looks up the exact key first. Without an entry it falls back to regex rules over the English
    // text with string values masked, which a numeric sample in the test above does not reproduce.
    const missing = [];
    visitTranslationKeys((key, file) => {
      if (!file.startsWith("features/") || !/\{\w+\}/.test(key) || Object.hasOwn(SPANISH_TRANSLATIONS, key)) return;
      missing.push(`${file}: ${key}`);
    });
    expect([...new Set(missing)]).toEqual([]);
  });

  it("translates the Classes notes that once leaked English", () => {
    expect(translateToSpanish("{month} monthly fee pending").replace("{month}", "octubre")).toBe(
      "Mensualidad de octubre pendiente",
    );
    expect(SPANISH_TRANSLATIONS["Owes {amount} from {count} classes since {date}"]).toBe(
      "Debe {amount} de {count} clases desde el {date}",
    );
    expect(translateToSpanish("Yesterday")).toBe("Ayer");
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
