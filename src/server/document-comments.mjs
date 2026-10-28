import { randomUUID } from "node:crypto";
import { CommentError, captureAnchor, locateAnchor, mutateComments, parseComments } from "./document-comments-format.mjs";

// Coordinates on the wire use the LF-normalized complete source, as CodeMirror does.
export function commentSelection(source, from, to) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const parsed = parseComments(normalized);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > normalized.length) {
    throw new CommentError("invalid_range", "Select a nonempty source range.");
  }
  const start = parsed.sourceStarts.indexOf(from);
  const end = parsed.sourceEnds.indexOf(to);
  if (start < 0 || end < start || parsed.sourceStarts.slice(start, end + 1).some((offset, i) => offset !== from + i)) {
    throw new CommentError("invalid_range", "Comment records cannot be part of a selection.");
  }
  return captureAnchor(parsed.body, start, end + 1);
}

export function commentsPayload(source, file) {
  if (!/\.md$/i.test(file)) return { supported: false, threads: [], diagnostics: [] };
  try {
    const parsed = parseComments(source.replace(/\r\n?/g, "\n"));
    return {
      supported: true,
      diagnostics: parsed.diagnostics,
      threads: parsed.records.filter((record) => record.valid).map(({ data }) => {
        const location = locateAnchor(parsed.body, data.anchor);
        if (location.state === "located") {
          location.from = parsed.sourceStarts[location.from];
          location.to = parsed.sourceEnds[location.to - 1];
          location.startLine = parsed.source.slice(0, location.from).split("\n").length;
          location.endLine = parsed.source.slice(0, location.to).split("\n").length;
        }
        return { ...data, location };
      }),
    };
  } catch (error) {
    return { supported: false, threads: [], diagnostics: [{ code: error.code ?? "invalid_document" }] };
  }
}

export function commentMutation(source, input, { now = () => new Date(), uuid = randomUUID } = {}) {
  const message = () => ({
    id: uuid(), author: { name: (typeof input.authorName === "string" ? input.authorName.trim() : "") || "Local author", kind: "human" },
    created_at: now().toISOString(), body: input.body,
  });
  let operation;
  if (input.type === "create") {
    operation = { type: "create", thread: {
      id: uuid(), status: "open", anchor: commentSelection(source, input.from, input.to), messages: [message()],
    } };
  } else if (input.type === "reply") {
    operation = { type: "reply", thread_id: input.threadId, message: message() };
  } else if (input.type === "set-status") {
    operation = { type: "set-status", thread_id: input.threadId, status: input.status };
  } else {
    throw new CommentError("invalid_operation", "Expected create, reply, or set-status.");
  }
  return mutateComments(source, operation);
}
