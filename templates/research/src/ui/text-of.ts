import { isValidElement, type ReactNode } from "react";

/** The text a rendered node reads as: its strings and numbers in order, through any elements that wrap them. */
export const textOf = (node: ReactNode): string =>
  typeof node === "string" || typeof node === "number" ? String(node)
  : Array.isArray(node) ? node.map(textOf).join("")
  : isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children)
  : "";
