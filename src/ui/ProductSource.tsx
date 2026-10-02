import type { ReactNode } from "react";
import { products, useProductStore, type ProductAttachment } from "../model/productLibrary";
import { attachmentIdOf, pageOfLocator, safeUrl } from "../model/products";

/** Open an attached file in a new tab, from this browser's own storage. */
export async function viewAttachment(att: Pick<ProductAttachment, "id" | "kind">, page?: number | null): Promise<string | null> {
  const blob = await products.file(att.id);
  if (!blob) return "This browser no longer has the file (site data cleared?). Its extracted text is still kept.";
  const url = URL.createObjectURL(blob);
  window.open(att.kind === "pdf" && page ? `${url}#page=${page}` : url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return null;
}

/** A source: an attached spec sheet (opens at its page), an external link, or plain text. */
export function Link({ url, children, locator }: { url: string; children?: ReactNode; locator?: string }) {
  const attId = attachmentIdOf(url);
  const att = useProductStore((s) => (attId ? s.requests.flatMap((r) => r.attachments ?? []).find((a) => a.id === attId) : undefined));
  if (attId !== null) {
    if (!att) return <span data-attachment={attId}>{children ?? `missing attachment ${attId}`}</span>;
    // the page the validator read from the locator, not just any number in it ("fig. 2")
    const page = att.kind === "pdf" ? pageOfLocator(locator) : null;
    return (
      <button type="button" className="linklike" data-attachment={attId} title={`Open ${att.name}${page ? ` at page ${page}` : ""}`}
        onClick={() => void viewAttachment(att, page)}>
        {children ?? att.name}
      </button>
    );
  }
  const href = safeUrl(url);
  const text = children ?? (href ? new URL(href).hostname : url);
  return href ? <a href={href} target="_blank" rel="noreferrer noopener">{text}</a> : <span>{text}</span>;
}

