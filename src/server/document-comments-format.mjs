import { createHash } from "node:crypto";
import { parseComments as parse, mutateComments as mutate } from "../content/document-comments.mjs";
export * from "../content/document-comments.mjs";

export function hashText(source) {
  return `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`;
}
export function parseComments(source) {
  const parsed = parse(source);
  return { ...parsed, sourceHash: hashText(source), bodyHash: hashText(parsed.body.replace(/\n+$/, "")) };
}
export function mutateComments(source, operation) {
  return mutate(source, operation, { hashBody: (body) => hashText(body.replace(/\n+$/, "")) });
}
