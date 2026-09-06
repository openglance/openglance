import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const LOCAL_LINK_SOURCE = "docs/README.md";
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="green"/></svg>';

export const LOCAL_LINK_CASES = [
  { name: "Chinese document", destination: "notes/课程详情.md", file: "docs/notes/课程详情.md" },
  { name: "Encoded Chinese", destination: "notes/%E8%AF%BE%E7%A8%8B%E8%AF%A6%E6%83%85.md", file: "docs/notes/课程详情.md" },
  { name: "Spaces", destination: "notes/design review.md", file: "docs/notes/design review.md" },
  { name: "Encoded spaces", destination: "notes/design%20review.md", file: "docs/notes/design review.md" },
  { name: "Percent", destination: "notes/100%.md", file: "docs/notes/100%.md" },
  { name: "Literal percent escape", destination: "notes/literal%2520.md", file: "docs/notes/literal%20.md" },
  { name: "Filename hash", destination: "notes/a%23b.md#details", file: "docs/notes/a#b.md", hash: "#details" },
  { name: "Query and fragment", destination: "notes/plain.md?view=full&tag=a&tag=b#details", file: "docs/notes/plain.md", query: { view: "full", tag: ["a", "b"] }, hash: "#details" },
  { name: "Source line fragment", destination: "notes/plain.md?view=full#L5", file: "docs/notes/plain.md", query: { view: "full" }, hash: "#L5" },
  { name: "Routing context", destination: "notes/plain.md?repo=other&file=wrong.md#details", file: "docs/notes/plain.md", hash: "#details" },
  { name: "ASCII", destination: "notes/plain.md", file: "docs/notes/plain.md" },
  { name: "Root relative MDX", destination: "/docs/notes/页面.mdx#details", file: "docs/notes/页面.mdx", hash: "#details" },
  { name: "Parent relative", destination: "../root.md", file: "root.md" },
  { name: "Encoded source directory", destination: "../目录%20%2525/page.md", file: "目录 %25/page.md" },
  { name: "Image", destination: "assets/图 表.svg", file: "docs/assets/图 表.svg", image: true, content: svg },
  { name: "Encoded image", destination: "assets/%E5%9B%BE%20%E8%A1%A8.svg?size=2#icon", file: "docs/assets/图 表.svg", image: true, content: svg, query: { size: "2" }, hash: "#icon" },
  { name: "HTML percent image", destination: "assets/图 100%.svg", file: "docs/assets/图 100%.svg", image: true, html: true, content: svg },
  { name: "Asset download", destination: "assets/数据%20表.csv?download=1", file: "docs/assets/数据 表.csv", content: "name,value\nsample,42\n", query: { download: "1" } },
];

export async function writeLocalLinkRepository(repoRoot) {
  for (const entry of LOCAL_LINK_CASES) {
    const target = path.join(repoRoot, entry.file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.content ?? `# Linked document\n\nTarget: ${entry.file}\n\n## Details\n\nCorrect local target.\n`);
  }
  // Distinguish the literal percent filename from the filename obtained by decoding twice.
  await writeFile(path.join(repoRoot, "docs/notes/literal .md"), "# Wrong target\n");
  const source = [
    "# Local links",
    "",
    "Links and images below must open their exact local paths in Preview and Live.",
    "",
    ...LOCAL_LINK_CASES.flatMap((entry) => [entry.html
      ? `<img src="${entry.destination}" alt="${entry.name}" />`
      : `${entry.image ? "!" : ""}[${entry.name}](<${entry.destination}>)`, ""]),
  ].join("\n");
  await writeFile(path.join(repoRoot, LOCAL_LINK_SOURCE), source);
  return source;
}
