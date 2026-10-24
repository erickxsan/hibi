import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { APPEARANCE_STORAGE_KEY, THEME_COLORS } from "./appearance.js";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const designSystem = stripComments(read("../design-system.css"));

const LIGHT_BLOCK = /(?:^|\n):root\s*\{([^}]*)\}/;
const SYSTEM_DARK_BLOCK =
  /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}\s*\}/;
const EXPLICIT_DARK_BLOCK = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/;
const COLOR_VALUE = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|color-mix\(/i;
const ALIAS = /^var\((--[\w-]+)\)$/;

function declarations(body) {
  return new Map(
    [...body.matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
  );
}

function block(pattern) {
  const match = designSystem.match(pattern);
  expect(match, `missing block ${pattern}`).toBeTruthy();
  return declarations(match[1]);
}

const light = block(LIGHT_BLOCK);
const systemDark = block(SYSTEM_DARK_BLOCK);
const explicitDark = block(EXPLICIT_DARK_BLOCK);
const colorTokens = [...light].filter(([name, value]) => name.startsWith("--") && COLOR_VALUE.test(value));
const aliasTokens = [...light].filter(([name, value]) => name.startsWith("--") && ALIAS.test(value));

/** Resolves a token to a hex colour in one theme (dark falls back to the light alias, as the cascade does). */
function resolve(theme, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`alias loop at ${name}`);
  seen.add(name);
  const value = theme.get(name) ?? light.get(name);
  const alias = value?.match(ALIAS);
  return alias ? resolve(theme, alias[1], seen) : value;
}

function luminance(hex) {
  const digits = hex.replace("#", "");
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits;
  const [r, g, b] = [0, 2, 4].map((index) => {
    const channel = parseInt(full.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(theme, foreground, background) {
  const [a, b] = [resolve(theme, foreground), resolve(theme, background)];
  expect(a, foreground).toMatch(/^#[0-9a-f]{6}$/i);
  expect(b, background).toMatch(/^#[0-9a-f]{6}$/i);
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function expectContrast(theme, pairs, minimum) {
  const failures = pairs
    .map(([foreground, background]) => [foreground, background, contrast(theme, foreground, background)])
    .filter(([, , ratio]) => ratio < minimum)
    .map(([foreground, background, ratio]) => `${foreground} on ${background}: ${ratio.toFixed(2)}`);
  expect(failures).toEqual([]);
}

const surfaces = ["--washi", "--papel", "--kraft", "--surface-raised"];
const textTokens = [
  "--sumi",
  "--sumi-muted",
  "--bermellon-strong",
  "--bermellon-ink",
  "--jade-strong",
  "--ocre-ink",
  "--indigo",
];
const cross = (foregrounds, backgrounds) => foregrounds.flatMap((fg) => backgrounds.map((bg) => [fg, bg]));

function cssFiles(directory = sourceRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(filename);
    return filename.endsWith(".css") ? [filename] : [];
  });
}

function sourceFiles(directory = sourceRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : sourceFiles(filename);
    return /\.(js|jsx)$/.test(entry.name) && !entry.name.includes(".test.") ? [filename] : [];
  });
}

describe("dark theme tokens", () => {
  it("gives every :root colour token a dark override, identical for Sistema and Oscuro", () => {
    expect(colorTokens.length).toBeGreaterThan(30);
    expect(colorTokens.filter(([name]) => !systemDark.has(name)).map(([name]) => name)).toEqual([]);
    // Aliases (e.g. --focus: var(--indigo)) follow their target, which must itself switch.
    const staleAliases = aliasTokens.filter(([name, value]) => {
      const target = value.match(ALIAS)[1];
      return COLOR_VALUE.test(resolve(light, target)) && !systemDark.has(name) && !systemDark.has(target);
    });
    expect(staleAliases).toEqual([]);
    expect(Object.fromEntries(explicitDark)).toEqual(Object.fromEntries(systemDark));
    expect([...systemDark.keys()].filter((name) => !light.has(name))).toEqual([]);
    expect(light.get("color-scheme")).toBe("light");
    expect(systemDark.get("color-scheme")).toBe("dark");
  });

  it("keeps body and secondary text at WCAG AA and controls at 3:1 in the dark theme", () => {
    expectContrast(systemDark, cross(textTokens, surfaces), 4.5);
    expectContrast(
      systemDark,
      [
        ["--bermellon-ink", "--bermellon-soft"],
        ["--jade-strong", "--jade-soft"],
        ["--ocre-ink", "--ocre-soft"],
        ["--indigo", "--indigo-soft"],
        ...cross(["--sumi", "--sumi-muted"], ["--bermellon-soft", "--jade-soft", "--ocre-soft", "--indigo-soft"]),
        ["--papel", "--sumi"],
        ["--on-accent", "--accent-fill"],
        ["--on-accent", "--accent-fill-hover"],
        ["--on-accent", "--danger-fill"],
        ["--on-accent", "--ok-fill"],
        ["--on-ocre", "--ocre"],
      ],
      4.5,
    );
    expectContrast(
      systemDark,
      [
        ...cross(["--line-control", "--focus"], surfaces),
        ...cross(["--bermellon", "--jade", "--ocre"], ["--washi", "--papel", "--surface-raised"]),
      ],
      3,
    );
  });

  it("keeps the role tokens readable in the light theme too", () => {
    expectContrast(light, cross(["--sumi", "--sumi-muted"], surfaces), 4.5);
    expectContrast(
      light,
      [
        ["--on-accent", "--accent-fill"],
        ["--on-accent", "--accent-fill-hover"],
        ["--on-accent", "--danger-fill"],
        ["--on-accent", "--ok-fill"],
        ["--on-ocre", "--ocre"],
      ],
      4.5,
    );
    expectContrast(light, cross(["--line-control", "--focus"], ["--washi", "--papel"]), 3);
  });

  it("separates page, sheet and floating layers by lightness in the dark theme", () => {
    const order = ["--washi", "--papel", "--surface-raised"].map((name) => luminance(resolve(systemDark, name)));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(3);
  });
});

describe("colours outside the tokens", () => {
  it("leaves no literal colours in feature and component CSS", () => {
    const literal = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![\w-])(?:white|black)(?![\w-])/i;
    const offenders = cssFiles().flatMap((filename) => {
      let css = stripComments(readFileSync(filename, "utf8"));
      if (filename.endsWith("design-system.css")) {
        for (const pattern of [LIGHT_BLOCK, SYSTEM_DARK_BLOCK, EXPLICIT_DARK_BLOCK]) css = css.replace(pattern, "\n");
      }
      css = css.replace(/@font-face\s*\{[^}]*\}/g, "");
      return css
        .split("\n")
        .map((line, index) => [index + 1, line])
        .filter(([, line]) => literal.test(line))
        .map(([line, text]) => `${path.relative(sourceRoot, filename)}:${line} ${String(text).trim()}`);
    });
    expect(offenders).toEqual([]);
  });

  it("keeps JS and SVG colours on tokens, except Google's brand mark and the browser chrome colours", () => {
    const allowed = new Set(["auth/AuthScreen.jsx", "theme/appearance.js"]);
    const offenders = sourceFiles()
      .map((filename) => path.relative(sourceRoot, filename).split(path.sep).join("/"))
      .filter((relative) => !allowed.has(relative))
      .filter((relative) =>
        /["'`]#[0-9a-f]{3}(?:[0-9a-f]{3})?["'`]|\brgba?\(/i.test(readFileSync(path.join(sourceRoot, relative), "utf8")),
      );
    expect(offenders).toEqual([]);
  });
});

describe("no-flash theme boot", () => {
  const indexHtml = read("../../index.html");
  const boot = read("../../public/theme-boot.js");
  const headers = read("../../public/_headers");

  it("loads the boot script as a blocking same-origin script in <head>, since the CSP forbids inline scripts", () => {
    const head = indexHtml.slice(0, indexHtml.indexOf("</head>"));
    expect(head).toMatch(/<script src="\/theme-boot\.js"><\/script>/);
    expect(head.indexOf('name="theme-color"')).toBeLessThan(head.indexOf("theme-boot.js"));
    expect(indexHtml).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    const scriptSrc = headers.match(/script-src ([^;]+)/)[1];
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("uses the same storage key and theme colours as the app module and the CSS tokens", () => {
    expect(boot).toContain(`"${APPEARANCE_STORAGE_KEY}"`);
    expect(boot).toContain(`"${THEME_COLORS.light}"`);
    expect(boot).toContain(`"${THEME_COLORS.dark}"`);
    expect(THEME_COLORS.light).toBe(light.get("--washi"));
    expect(THEME_COLORS.dark).toBe(systemDark.get("--washi"));
    expect(indexHtml).toContain(`<meta name="theme-color" content="${THEME_COLORS.light}" />`);
  });
});
