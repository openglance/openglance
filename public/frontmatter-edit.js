const FRONTMATTER_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

export function frontmatterLineForValue(key, value) {
  const normalizedKey = String(key ?? "").trim();
  if (!FRONTMATTER_KEY_PATTERN.test(normalizedKey)) {
    return "";
  }
  return `${normalizedKey}: ${String(value ?? "").trim()}`;
}

export function frontmatterSourceSignature(source) {
  return frontmatterBlockLines(source)?.lines.join("\n") ?? "";
}

export function frontmatterKeysFromSource(source) {
  const block = frontmatterBlockLines(source);
  if (!block) {
    return [];
  }

  const keys = [];
  for (const line of block.lines) {
    const match = /^([A-Za-z0-9_-]+):/.exec(line);
    if (match) {
      keys.push(match[1]);
    }
  }
  return keys;
}

export function addFrontmatterFieldToSource(source, key, value) {
  const line = frontmatterLineForValue(key, value);
  if (!line) {
    return String(source ?? "");
  }

  const text = String(source ?? "");
  const block = frontmatterBlockLines(text);
  if (!block) {
    return `---\n${line}\n---\n\n${text}`;
  }

  const lines = text.split(/\r?\n/);
  lines.splice(block.endLineIndex, 0, line);
  return lines.join("\n");
}

export function deleteFrontmatterLineFromSource(source, lineNumber) {
  const lines = String(source ?? "").split(/\r?\n/);
  if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > lines.length) {
    return String(source ?? "");
  }

  lines.splice(lineNumber - 1, 1);
  return lines.join("\n");
}

function frontmatterBlockLines(source) {
  const lines = String(source ?? "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return null;
  }

  const endLineIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endLineIndex === -1) {
    return null;
  }

  return {
    lines: lines.slice(1, endLineIndex),
    endLineIndex,
  };
}
