/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the DiffCommentApi contract. */
export { DiffViewer } from "./DiffViewer";
export { FileCard } from "./FileCard";
export type { LineAdornment } from "./FileCard";
export { lineDomId } from "./helpers";
export type { DiffCommentApi } from "./comments";
